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
            
            # 检测是否为空，若空则灌注 4 大核心内置模板种子数据
            cursor.execute("SELECT COUNT(*) FROM document_templates")
            count = cursor.fetchone()[0]
            
            if count == 0:
                print("🌱 [SQLite-Seed] 检测到模板数据库为空，正在注入四大黄金内置专家模板种子...")
                
                default_contract = """你是一位极其严谨的资深采购与法务审计专家。请仔细审阅这份合同。
你的任务是精确提取合同的核心条款，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "合同主标题",
  "parties": ["甲方公司名称", "乙方公司名称"],
  "key_dates": {
    "签署日期": "YYYY-MM-DD", 
    "截止日期": "YYYY-MM-DD"
  },
  "amount": 100000.00,
  "currency": "CNY",
  "summary": "合同核心采购标的和履约责任摘要（100字内）",
  "dynamic_attributes": {
    "buyer": "合同甲方(采购方)单位全称",
    "seller": "合同乙方(供货方)单位全称",
    "delivery_deadline": "最晚交货期限",
    "warranty_years": "质保年限"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "确定合同标题的原文段落",
    "parties": "确定签署双方(甲乙方)全称的原文条款原句",
    "key_dates": "确定合同签署日期与截止日期的原文条款原句",
    "amount": "确定合同总金额的原文条款原句",
    "currency": "确定计价货币的原文条款原句",
    "summary": "确定核心标的、履约责任对应的原文条款原句",
    "buyer": "确定甲方采购方名称的原文条款原句",
    "seller": "确定乙方供货方名称的原文条款原句",
    "delivery_deadline": "确定最晚交货期限的原文条款原句",
    "warranty_years": "确定质保年限的原文条款原句"
  }
}

【判定来源法务审计要求】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的 buyers/sellers/delivery_deadline 等）提供在合同原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到合同章节条款（如：“根据第二条第1款：交货期限为...”），绝不可含糊编造。若无原文提及，请写“未在合同原文中提及”。"""
                
                default_resume = """你是一位资深猎头和 HR 总监。请评估这份简历，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "姓名_求职简历",
  "parties": ["姓名", "最近任职公司"],
  "key_dates": {"最近入职时间": "YYYY-MM-DD"},
  "amount": null,
  "currency": "CNY",
  "summary": "候选人评价",
  "dynamic_attributes": {"job_title": "求职岗位", "skills": "核心技术栈"},
  "confidence_score": "high",
  "evidence": {"skills": "核心技能依据"}
}"""
                
                default_invoice = """你是一位资深出纳与税务专家。请核对这张发票，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "发票_开票方",
  "parties": ["销售方", "购买方"],
  "key_dates": {"开票日期": "YYYY-MM-DD"},
  "amount": 5000.00,
  "currency": "CNY",
  "summary": "服务摘要",
  "dynamic_attributes": {"invoice_code": "发票号码", "tax_rate": "税率"},
  "confidence_score": "high",
  "evidence": {"amount": "发票金额依据"}
}"""
                
                default_other = """你是一个全能商业文档助理。请阅读文件并做最简总结，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "文件主标题",
  "parties": ["相关主体"],
  "key_dates": {"关联日期": "YYYY-MM-DD"},
  "amount": null,
  "currency": "CNY",
  "summary": "一句话核心内容摘要",
  "dynamic_attributes": {"document_purpose": "该文件用途"},
  "confidence_score": "high",
  "evidence": {}
}"""
                
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
                # 若已存在数据，但老版本没有初始化新字段值，则进行平稳值设置保护
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

            # 💡 [SystemConfigs-Table] 创建系统核心配置参数表 (Key-Value)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS system_configs (
                    config_key TEXT PRIMARY KEY,
                    config_value TEXT NOT NULL
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

# 实例化全局单例
db_service = DatabaseService()
