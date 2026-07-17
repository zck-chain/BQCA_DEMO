# -*- coding: utf-8 -*-
import os
import sqlite3

class DatabaseService:
    def __init__(self):
        self.db_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
        os.makedirs(self.db_dir, exist_ok=True)
        self.db_path = os.path.join(self.db_dir, "metadata.db")
        self.init_database()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_database(self):
        """初始化 SQLite 数据库及创建表格，支持种子数据预注入（Seed）和在线平滑升级"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS document_templates (
                    category TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    prompt_template TEXT NOT NULL,
                    temperature REAL DEFAULT 0.1,
                    max_output_tokens INTEGER DEFAULT 1024,
                    top_p REAL DEFAULT 0.95,
                    response_mime_type TEXT DEFAULT 'application/json',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # 动态迁移，检测并补充缺少的字段以平滑兼容老版本
            cursor.execute("PRAGMA table_info(document_templates)")
            columns = [info[1] for info in cursor.fetchall()]
            
            if "temperature" not in columns:
                print("🔄 [SQLite-Migrate] 正在升级数据表，增加温度字段...")
                cursor.execute("ALTER TABLE document_templates ADD COLUMN temperature REAL DEFAULT 0.1")
            if "max_output_tokens" not in columns:
                print("🔄 [SQLite-Migrate] 正在升级数据表，增加最大 Token 字段...")
                cursor.execute("ALTER TABLE document_templates ADD COLUMN max_output_tokens INTEGER DEFAULT 1024")
            if "top_p" not in columns:
                print("🔄 [SQLite-Migrate] 正在升级数据表，增加 Top P 字段...")
                cursor.execute("ALTER TABLE document_templates ADD COLUMN top_p REAL DEFAULT 0.95")
            if "response_mime_type" not in columns:
                print("🔄 [SQLite-Migrate] 正在升级数据表，增加 Response Format 字段...")
                cursor.execute("ALTER TABLE document_templates ADD COLUMN response_mime_type TEXT DEFAULT 'application/json'")
            
            # 定义最顶级的大一统模板内容
            default_contract = """你是一位极其严谨的资深“采购与法务审计专家”。请仔细审阅这份合同。
你的任务是精确提取合同的核心条款，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "合同主标题",
  "parties": ["采购方(甲方)企业全称", "销售方(乙方)企业全称"],
  "key_dates": {
    "合同签署日期": "YYYY-MM-DD",
    "合同截止日期": "YYYY-MM-DD"
  },
  "amount": 100000.00,
  "currency": "CNY",
  "summary": "关于该采购合同的核心履约责任、采购标的物与交付要求的精简总结",
  "dynamic_attributes": {
    "交货期限": "最晚交货期限或工程完工节点约定",
    "质保期限": "售后质保与硬件保修期限约定",
    "付款方式": "合同款项分期结算与付款要求约定"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "合同文本中关于主标题判定的原文依据段落与条款原句",
    "parties": "合同文本中签署双方甲乙企业名称判定的原文依据条款原句",
    "key_dates": "合同签署与截止期限判定的原文依据条款原句",
    "amount": "确定合同交易总金额判定的原文依据条款原句",
    "currency": "确定计价币种判定的原文依据条款原句",
    "summary": "确定合同总结信息的原文判定依据",
    "交货期限": "确定交货期约定的原文条款段落依据",
    "质保期限": "确定质保期约定的原文条款段落依据",
    "付款方式": "确定付款方式约定的原文条款段落依据"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据第三条第1款：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。"""

            default_resume = """你是一位极其严谨的资深“猎头招聘与人才审计专家”。请仔细审阅这份候选人求职简历。
你的任务是精确提取人才的核心资历，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "候选人求职简历标准标题",
  "parties": ["候选人姓名", "最近任职公司或毕业院校名称"],
  "key_dates": {
    "最近任职开始时间": "YYYY-MM-DD",
    "最近任职结束时间": "YYYY-MM-DD"
  },
  "amount": null,
  "currency": "CNY",
  "summary": "对该候选人专业技术背景、项目亮点与岗位匹配度的客观评价总结",
  "dynamic_attributes": {
    "求职岗位": "候选人求职或最近一段履历的岗位名称",
    "核心技术栈": "候选人最擅长且具备深度实战经验的核心技术体系",
    "工作年限": "候选人从第一份工作起算的总工作资历时长"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "简历文本中关于候选人主标题判定的原文依据段落原句",
    "parties": "简历文本中确定姓名、就职单位判定的原文依据段落原句",
    "key_dates": "简历中最近任职起止期限判定的原文依据条款原句",
    "amount": "确定期望薪资或财务属性的原文依据段落（若无请写“无”）",
    "currency": "确定期望薪资币种判定的原文依据段落（若无请写“无”）",
    "summary": "确定总结信息的原文判定依据",
    "求职岗位": "确定期望岗位的原文段落依据",
    "核心技术栈": "确定擅长技术栈的原文段落依据",
    "工作年限": "确定工作年限判定的原文段落依据"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据简历第几段：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。"""

            default_invoice = """你是一位极其严谨的资深“出纳审计与财务税务合规专家”。请仔细审阅这份发票凭证。
你的任务是精确提取发票的核对条款，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "发票标准标题",
  "parties": ["销售方(开票单位)企业全称", "购买方(受票单位)企业全称"],
  "key_dates": {
    "开票日期": "YYYY-MM-DD"
  },
  "amount": 10000.00,
  "currency": "CNY",
  "summary": "发票所开具的主营服务、商品类别及税率明细简述",
  "dynamic_attributes": {
    "发票号码": "发票票面上唯一的识别开票代码",
    "发票税率": "财务税控核账的法定开票税率"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "发票票面上标题判定的原文依据",
    "parties": "销售方与购买方企业名称判定的原文票面依据原句",
    "key_dates": "发票开具日期判定的原文票面依据原句",
    "amount": "确定发票含税总金额判定的原文票面依据原句",
    "currency": "确定发票计价币种判定的原文票面依据原句",
    "summary": "确定发票服务明细内容的原文判定依据",
    "发票号码": "确定发票号码判定的原文票面依据原句",
    "发票税率": "确定开票税率判定的原文票面依据原句"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据发票右上方：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。"""

            default_other = """你是一位极其严谨的资深“商业综合文档审计专家”。请仔细审阅这份综合性文档。
你的任务是精确提取文档的核心商业情报，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "文档主标题",
  "parties": ["文档提及的核心主体或公司名称列表"],
  "key_dates": {
    "关键时间时点": "YYYY-MM-DD"
  },
  "amount": null,
  "currency": "CNY",
  "summary": "对该综合文档一句话中文核心内容总结",
  "dynamic_attributes": {
    "文档分类描述": "大模型判定该文档的物理公约数分类属性",
    "核心结论": "文档中提炼出的对企业决策最关键的结论"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "文档文本中确定标题的原文依据段落",
    "parties": "文档中关于提及主体判定的原文依据段落",
    "key_dates": "文档中关键时间判定的原文依据段落",
    "amount": "文档中涉及的合同/交易金额依据（若无请写“无”）",
    "currency": "文档中涉及的计价币种依据（若无请写“无”）",
    "summary": "摘要提炼得出的原文段落依据",
    "文档分类描述": "确定文档属性分类的原文依据",
    "核心结论": "确定核心结论的原文段落依据"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据文档第几段：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。"""

            # 检测是否为空，若空则灌注 4 大核心内置模板种子数据
            cursor.execute("SELECT COUNT(*) FROM document_templates")
            count = cursor.fetchone()[0]
            
            if count == 0:
                print("🌱 [SQLite-Seed] 检测到模板数据库为空，正在注入四大黄金内置专家模板种子...")
                seeds = [
                    ("contract", "合同法务专家", default_contract, 0.1, 1024, 0.95, "application/json"),
                    ("resume", "猎头与招聘总监", default_resume, 0.4, 1024, 0.95, "application/json"),
                    ("invoice", "发票财务审核", default_invoice, 0.1, 512, 0.95, "application/json"),
                    ("other", "通用文档处理", default_other, 0.2, 1024, 0.95, "application/json"),
                ]
                cursor.executemany("""
                    INSERT INTO document_templates (category, display_name, prompt_template, temperature, max_output_tokens, top_p, response_mime_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, seeds)
                conn.commit()
                print("🎉 [SQLite-Seed] 内置种子数据注入成功！")
            else:
                # ⚡【热更新强制对齐】：首长以前库里若已经有数据，我们直接在每次启动时将其强制刷新为大统一合规模板，确保 100% 体验一致！
                cursor.execute("UPDATE document_templates SET display_name = '合同法务专家', prompt_template = ? WHERE category = 'contract'", (default_contract,))
                cursor.execute("UPDATE document_templates SET display_name = '猎头与招聘总监', prompt_template = ? WHERE category = 'resume'", (default_resume,))
                cursor.execute("UPDATE document_templates SET display_name = '发票财务审核', prompt_template = ? WHERE category = 'invoice'", (default_invoice,))
                cursor.execute("UPDATE document_templates SET display_name = '通用文档处理', prompt_template = ? WHERE category = 'other'", (default_other,))
                
                # 升级老版本没有初始化新字段值时的平稳值设置保护
                cursor.execute("""
                    UPDATE document_templates 
                    SET temperature = 0.1, max_output_tokens = 512 
                    WHERE category = 'invoice' AND (max_output_tokens IS NULL OR max_output_tokens = 1024)
                """)
                cursor.execute("""
                    UPDATE document_templates 
                    SET temperature = 0.4 
                    WHERE category = 'resume' AND (temperature IS NULL OR temperature = 0.1)
                """)
                conn.commit()
                print("⚡ [SQLite-Migrate] 四大黄金内置模版已成功热同步对齐为最新审计级 Schema 格式！")

            # 💡 [SystemConfigs-Table] 创建系统核心配置参数表 (Key-Value)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS system_configs (
                    config_key TEXT PRIMARY KEY,
                    config_value TEXT NOT NULL
                )
            """)
            
            # 💡 [PendingExtractionResults-Table] 新增大模型 Pending 数据 SQLite 本地持久化缓存表，彻底降本增效！
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS pending_extraction_results (
                    workspace_id TEXT,
                    uri TEXT,
                    doc_type TEXT,
                    raw_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (workspace_id, uri)
                )
            """)
            
            # 检测是否配置为空，若空则灌注 GCP 三要素默认种子
            cursor.execute("SELECT COUNT(*) FROM system_configs")
            config_count = cursor.fetchone()[0]
            if config_count == 0:
                print("🌱 [SQLite-Seed] 检测到配置表为空，正在注入默认 GCP 种子...")
                configs = [
                    ("gcp_project_id", "webeye-internal-test"),
                    ("gcs_bucket_name", "bqca-demo"),
                    ("bq_connection_name", "bqca_external_connection")
                ]
                cursor.executemany("""
                    INSERT INTO system_configs (config_key, config_value)
                    VALUES (?, ?)
                """, configs)
                conn.commit()

    def list_templates(self):
        """列出所有已注册的分类模板"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT category, display_name, prompt_template, temperature, max_output_tokens, top_p, response_mime_type FROM document_templates ORDER BY created_at ASC")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def save_template(self, category: str, display_name: str, prompt_template: str, temperature: float = 0.1, max_output_tokens: int = 1024, top_p: float = 0.95, response_mime_type: str = "application/json"):
        """新增或更新模版提示词与相关大模型调用参数"""
        category = category.lower().strip()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO document_templates (category, display_name, prompt_template, temperature, max_output_tokens, top_p, response_mime_type)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(category) DO UPDATE SET
                    display_name = excluded.display_name,
                    prompt_template = excluded.prompt_template,
                    temperature = excluded.temperature,
                    max_output_tokens = excluded.max_output_tokens,
                    top_p = excluded.top_p,
                    response_mime_type = excluded.response_mime_type
            """, (category, display_name.strip(), prompt_template.strip(), float(temperature), int(max_output_tokens), float(top_p), response_mime_type.strip()))
            conn.commit()
        return True

    def delete_template(self, category: str):
        """删除某个模板（系统内置 4 类保护不可删除，只能修改）"""
        category = category.lower().strip()
        if category in ["contract", "resume", "invoice", "other"]:
            raise ValueError("系统内置核心模板不可被删除，仅支持精调修改！")
            
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM document_templates WHERE category = ?", (category,))
            conn.commit()
        return True

    def get_system_config(self, key: str, default: str = "") -> str:
        """获取系统核心全局配置"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT config_value FROM system_configs WHERE config_key = ?", (key.strip(),))
            row = cursor.fetchone()
            return row["config_value"] if row else default

    def set_system_config(self, key: str, value: str):
        """设置系统核心全局配置"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO system_configs (config_key, config_value)
                VALUES (?, ?)
                ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value
            """, (key.strip(), str(value).strip()))
            conn.commit()
        return True

    # =========================================================================
    # 💡 [SaaS Pending Cache CRUD] 新增大模型 Pending 结果 SQLite 持久化层
    # =========================================================================
    def save_pending_results(self, workspace_id: str, results_list: list):
        """批量持久化保存大模型跑出来的 Pending 增量结果"""
        import json
        with self.get_connection() as conn:
            cursor = conn.cursor()
            for row in results_list:
                row_map = dict(row) if not isinstance(row, dict) else row
                uri = row_map.get("uri")
                doc_type = row_map.get("doc_type") or "other"
                if not uri:
                    continue
                # 将整行原汁原味序列化为 JSON 字符串保存
                raw_json = json.dumps(row_map, ensure_ascii=False)
                cursor.execute("""
                    INSERT INTO pending_extraction_results (workspace_id, uri, doc_type, raw_json)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(workspace_id, uri) DO UPDATE SET
                        doc_type = excluded.doc_type,
                        raw_json = excluded.raw_json,
                        created_at = CURRENT_TIMESTAMP
                """, (workspace_id.strip(), uri.strip(), doc_type, raw_json))
            conn.commit()
        print(f"📦 [SQLite-Cache] 成功对 {len(results_list)} 条大模型 Pending 结果执行 SQLite 物理持久化备份！")
        return True

    def get_pending_results(self, workspace_id: str) -> list:
        """从 SQLite 中秒级获取当前隔离空间下所有缓存的 Pending 数据"""
        import json
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT raw_json FROM pending_extraction_results 
                WHERE workspace_id = ? 
                ORDER BY created_at ASC
            """, (workspace_id.strip(),))
            rows = cursor.fetchall()
            results = []
            for r in rows:
                try:
                    row_dict = json.loads(r["raw_json"])
                    results.append(row_dict)
                except Exception as e:
                    print(f"⚠️ [SQLite-Cache] 反序列化缓存异常: {str(e)}")
            return results

    def delete_pending_result_by_uri(self, workspace_id: str, uri: str):
        """物理清除某条已经被人工核对保存并落盘（Approved）的文件 Pending 缓存"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                DELETE FROM pending_extraction_results 
                WHERE workspace_id = ? AND uri = ?
            """, (workspace_id.strip(), uri.strip()))
            conn.commit()
        print(f"🧹 [SQLite-Cache] 文件 {uri} 成功核对通过，已物理剔除 SQLite 临时 Pending 缓存！")
        return True

# 实例化全局单例
db_service = DatabaseService()
