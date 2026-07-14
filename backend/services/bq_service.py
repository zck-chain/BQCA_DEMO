# -*- coding: utf-8 -*-
"""
📊 Google BigQuery 服务编排层
核心更新：
  1. 支持两阶段路由 DDL 动态传参热编译。
  2. 人工核对一键持久化建表，并动态注入 Column Description DDL OPTIONS 语义描述。
"""

import json
from google.cloud import bigquery
from backend import config
from backend import sql_templates


class BigQueryService:
    def __init__(self):
        self.client = bigquery.Client(project=config.PROJECT_ID)
        self.resolve_dynamic_location()

    def resolve_dynamic_location(self):
        """
        全自动拉取 GCS 存储桶的物理区域 (Location)，
        并动态同步修改全局 Location 与 BigQuery 外部连接 Connection ID 位置。
        """
        from google.cloud import storage
        try:
            storage_client = storage.Client(project=config.PROJECT_ID)
            bucket = storage_client.get_bucket(config.GLOBAL_STORAGE_BUCKET)
            bucket_location = bucket.location  # 如 "US"、"us-central1"
            
            # BigQuery 数据集的 Location 习惯用大写 (e.g. "US"), GCP 资源路径中的 Location 习惯用小写 (e.g. "us")
            config.LOCATION = bucket_location.upper()
            config.GLOBAL_BQ_CONNECTION = f"projects/{config.PROJECT_ID}/locations/{config.LOCATION.lower()}/connections/bqca_external_connection"
            config.GEMINI_MODEL_ID = f"{config.PROJECT_ID}.{config.SHARED_DATASET}.gemini_flash_model"
            print(f"🛰️ [Auto-Location] 成功探测并实现 100% 区域对齐！")
            print(f"   ↳ GCS 存储桶: {config.GLOBAL_STORAGE_BUCKET} [区域: {bucket_location}]")
            # 打印连接，并处理多区域 us -> lowercase
            print(f"   ↳ 关联连接: {config.GLOBAL_BQ_CONNECTION}")
            print(f"   ↳ BQ 物理位置: {config.LOCATION}")
        except Exception as e:
            print(f"⚠️ [Auto-Location] 动态探测 GCS 存储桶区域失败 (回退至默认值 {config.LOCATION}): {str(e)}")

    def ensure_shared_assets_exist(self):
        """
        自动创建共享数据集 workspace_shared_connection 以及 BQML 大模型对象，
        实现 100% 自愈开箱即用。
        """
        # 1. 自动创建共享连接数据集
        shared_dataset_id = f"{config.PROJECT_ID}.{config.SHARED_DATASET}"
        dataset = bigquery.Dataset(shared_dataset_id)
        dataset.location = config.LOCATION
        self.client.create_dataset(dataset, exists_ok=True)
        
        # 2. 自动在此数据集下创建 Gemini Flash 模型 (引用用户的 bqca_external_connection 连接)
        model_ddl = f"""
            CREATE MODEL IF NOT EXISTS `{config.PROJECT_ID}.{config.SHARED_DATASET}.gemini_flash_model`
            REMOTE WITH CONNECTION `{config.GLOBAL_BQ_CONNECTION}`
            OPTIONS (
              ENDPOINT = 'gemini-2.5-flash'
            );
        """
        print(f"🧬 [Self-Healing] 正在确保 BQML 大模型 {config.PROJECT_ID}.{config.SHARED_DATASET}.gemini_flash_model 存在且可用...")
        self.client.query(model_ddl).result()

    def initialize_workspace_dataset(self, workspace_id: str, workspace_name: Optional[str] = None):
        dataset_id = f"{config.PROJECT_ID}.workspace_{workspace_id}"
        dataset = bigquery.Dataset(dataset_id)
        dataset.location = config.LOCATION
        if workspace_name:
            dataset.description = workspace_name
        self.client.create_dataset(dataset, exists_ok=True)
        
        # 如果已经存在但当时没写描述，可以增量更新一次以确保 100% 写入
        if workspace_name:
            try:
                ds = self.client.get_dataset(dataset_id)
                ds.description = workspace_name
                self.client.update_dataset(ds, ["description"])
            except Exception as e:
                print(f"⚠️ [Dataset-Desc] 更新说明注释异常: {str(e)}")
                
        return dataset_id

    def create_external_object_table(self, workspace_id: str, gcs_folder_uri: str) -> str:
        dataset_id = f"workspace_{workspace_id}"
        table_name = f"{config.PROJECT_ID}.{dataset_id}.t_object_table"
        
        object_table_ddl = f"""
            CREATE EXTERNAL TABLE IF NOT EXISTS `{table_name}`
            WITH CONNECTION `{config.GLOBAL_BQ_CONNECTION}`
            OPTIONS (
              object_metadata = 'SIMPLE',
              uris = ['{gcs_folder_uri}*']
            );
        """
        self.client.query(object_table_ddl).result()
        return table_name

    def deploy_two_stage_extraction_views(self, workspace_id: str, temperature: float = 0.1, max_output_tokens: int = 1024,
                                          prompt_contract: str = None, prompt_resume: str = None,
                                          prompt_invoice: str = None, prompt_other: str = None):
        """
        3. 【动态热编译部署】一键将用户在 SQLite 数据库里自定义的分类和提示词热部署进 BigQuery View。
        """
        from backend.services.db_service import db_service
        dataset_id = f"workspace_{workspace_id}"
        
        # 3.1 对齐持久化：如果有来自前端的显式精调参数修改，同步更新至 SQLite 保证不丢失
        if prompt_contract:
            db_service.save_template("contract", "合同法务专家", prompt_contract)
        if prompt_resume:
            db_service.save_template("resume", "猎头与招聘总监", prompt_resume)
        if prompt_invoice:
            db_service.save_template("invoice", "发票财务审核", prompt_invoice)
        if prompt_other:
            db_service.save_template("other", "通用文档处理", prompt_other)

        # 3.2 从本地 SQLite 数据库中实时加载所有自定义分类模板
        templates = db_service.list_templates()
        categories = [t["category"] for t in templates]
        categories_str = "、".join(categories)
        
        # 3.3 动态组装阶段一分类器提示词并执行热重构
        prompt_classifier = f"请阅读文件，只输出以下类别单词之一：{categories_str}。绝对不要带有任何多余字符！"
        stage1_ddl = sql_templates.CLASSIFIER_SQL_TEMPLATE.format(
            project_id=config.PROJECT_ID,
            dataset_id=dataset_id,
            model_id=config.GEMINI_MODEL_ID,
            prompt_classifier=prompt_classifier
        )
        self.client.query(stage1_ddl).result()

        # 3.4 动态组装阶段二路由专家提取 CASE 分支
        case_clauses = []
        other_prompt_escaped = ""
        for t in templates:
            cat = t["category"]
            p_content = t["prompt_template"].replace("'", "''")
            
            # 记录 other 模板以便作为默认 ELSE 分支
            if cat == "other":
                other_prompt_escaped = p_content
                
            case_clauses.append(f"WHEN '{cat}' THEN \n        '''{p_content}'''")
            
        # 添加安全兜底的 ELSE 分支，避免出现分类遗漏时 DDL 视图解析崩溃
        if other_prompt_escaped:
            case_clauses.append(f"ELSE \n        '''{other_prompt_escaped}'''")
            
        case_statements = "\n      ".join(case_clauses)

        # 3.5 动态编译两阶段提取 DDL 并执行
        stage2_ddl = sql_templates.ROUTED_EXTRACTION_SQL_TEMPLATE.format(
            project_id=config.PROJECT_ID,
            dataset_id=dataset_id,
            model_id=config.GEMINI_MODEL_ID,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            case_statements=case_statements
        )
        self.client.query(stage2_ddl).result()
        return f"{config.PROJECT_ID}.{dataset_id}.v_stage2_routed_extractor"

    def refresh_external_table_cache(self, workspace_id: str):
        dataset_id = f"workspace_{workspace_id}"
        table_name = f"{config.PROJECT_ID}.{dataset_id}.t_object_table"
        refresh_sql = f"CALL BQ.REFRESH_EXTERNAL_METADATA_CACHE('{table_name}');"
        self.client.query(refresh_sql).result()

    def fetch_extraction_results(self, workspace_id: str) -> list:
        dataset_id = f"workspace_{workspace_id}"
        query = f"SELECT * FROM `{config.PROJECT_ID}.{dataset_id}.v_stage2_routed_extractor` LIMIT 100;"
        query_job = self.client.query(query)
        rows = query_job.result()
        
        results = []
        for row in rows:
            results.append({
                "uri": row.get("uri"),
                "doc_type": row.get("doc_type"),
                "doc_title": row.get("doc_title"),
                "parties": json.loads(row.get("parties")) if row.get("parties") else [],
                "key_dates": json.loads(row.get("key_dates")) if row.get("key_dates") else {},
                "amount": row.get("amount"),
                "currency": row.get("currency"),
                "summary": row.get("summary"),
                "dynamic_attributes": json.loads(row.get("dynamic_attributes")) if row.get("dynamic_attributes") else {},
                "confidence_score": row.get("confidence_score", "high"),
                "evidence": json.loads(row.get("evidence")) if row.get("evidence") else {},
                "parse_status": "approved" if row.get("confidence_score") == "high" else "pending_review"
            })
        return results

    def approve_and_correct_data(self, workspace_id: str, payload: dict) -> bool:
        """
        6. 【HIL 语义建表】人工核对订正写回，同时自动注入 Schema OPTIONS 描述，赋能 BQCA 彻底消除聊天幻觉！
        """
        dataset_id = f"workspace_{workspace_id}"
        results_table = f"{config.PROJECT_ID}.{dataset_id}.t_verified_smart_drive"

        # 1. 动态生成干净的物理表结构并注入极其精准的语义层 Description 列选项！
        init_table_ddl = f"""
            CREATE TABLE IF NOT EXISTS `{results_table}` (
              uri STRING OPTIONS (description="GCS存储桶中文件的唯一物理路径（主键）"),
              doc_type STRING OPTIONS (description="大模型判定的文件类型，如 contract(合同), resume(简历), invoice(发票)"),
              doc_title STRING OPTIONS (description="人工核对校验后的完美文件标题"),
              parties JSON OPTIONS (description="数组类型：文件中提及的所有核心相关公司全称或人名（例如采购合同的采购方和供应商）"),
              key_dates JSON OPTIONS (description="JSON字典：业务关键日期及其含义键值对（例如签署和截止日期，支持 JSON_VALUE）"),
              amount FLOAT64 OPTIONS (description="合同发票审计金额（FLOAT64），可以直接做数值求和或大小比较"),
              currency STRING OPTIONS (description="法定币种简写（如 CNY, USD）"),
              summary STRING OPTIONS (description="文件一句话核心中文摘要（100字内）"),
              dynamic_attributes JSON OPTIONS (description="自适应特有核心属性（例如合同的质保期和交货限期，求职人的求职岗位和技术栈，支持 JSON 穿透）"),
              parse_status STRING OPTIONS (description="解析状态，在人工确认后强制标记为 approved 归档")
            );
        """
        self.client.query(init_table_ddl).result()

        # 2. 合并写入（Upsert / Merge）
        upsert_dml = f"""
            MERGE `{results_table}` T
            USING (SELECT @uri AS uri) S
            ON T.uri = S.uri
            WHEN MATCHED THEN
              UPDATE SET 
                doc_title = @doc_title,
                parties = SAFE.PARSE_JSON(@parties),
                key_dates = SAFE.PARSE_JSON(@key_dates),
                amount = @amount,
                currency = @currency,
                summary = @summary,
                dynamic_attributes = SAFE.PARSE_JSON(@dynamic_attributes),
                parse_status = 'approved'
            WHEN NOT MATCHED THEN
              INSERT (uri, doc_type, doc_title, parties, key_dates, amount, currency, summary, dynamic_attributes, parse_status)
              VALUES (@uri, @doc_type, @doc_title, SAFE.PARSE_JSON(@parties), SAFE.PARSE_JSON(@key_dates), @amount, @currency, @summary, SAFE.PARSE_JSON(@dynamic_attributes), 'approved');
        """
        
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("uri", "STRING", payload["uri"]),
                bigquery.ScalarQueryParameter("doc_type", "STRING", payload.get("doc_type", "other")),
                bigquery.ScalarQueryParameter("doc_title", "STRING", payload["doc_title"]),
                bigquery.ScalarQueryParameter("parties", "STRING", json.dumps(payload["parties"], ensure_ascii=False)),
                bigquery.ScalarQueryParameter("key_dates", "STRING", json.dumps(payload["key_dates"], ensure_ascii=False)),
                bigquery.ScalarQueryParameter("amount", "FLOAT64", payload["amount"]),
                bigquery.ScalarQueryParameter("currency", "STRING", payload["currency"]),
                bigquery.ScalarQueryParameter("summary", "STRING", payload["summary"]),
                bigquery.ScalarQueryParameter("dynamic_attributes", "STRING", json.dumps(payload["dynamic_attributes"], ensure_ascii=False)),
            ]
        )
        self.client.query(upsert_dml, job_config=job_config).result()
        return True

    def list_workspaces(self) -> list:
        """
        列出当前 GCP 项目下所有已经部署和存在的 SaaS 隔离数仓项目空间。
        """
        try:
            datasets = list(self.client.list_datasets())
            workspaces = []
            for dataset in datasets:
                ds_id = dataset.dataset_id
                if ds_id.startswith("workspace_") and ds_id != "workspace_shared_connection":
                    # 剥离前缀，获取真实的 workspace_id
                    workspace_id = ds_id.replace("workspace_", "", 1)
                    
                    # 从 BQ 获取完整的 Dataset 对象以读取其 description 作为中文空间名
                    try:
                        full_ds = self.client.get_dataset(dataset.reference)
                        workspace_name = full_ds.description or f"隔离数仓空间 ({workspace_id})"
                    except Exception:
                        workspace_name = f"隔离数仓空间 ({workspace_id})"
                        
                    # 拼装优雅的返回属性
                    workspaces.append({
                        "workspace_id": workspace_id,
                        "workspace_name": workspace_name
                    })
            return workspaces
        except Exception as e:
            print(f"⚠️ [BQ-List] 获取数据集工作空间列表失败: {str(e)}")
            return []
