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
        """初始化 SQLite 数据库及创建表格，支持种子数据预注入（Seed）"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS document_templates (
                    category TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    prompt_template TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # 检测是否为空，若空则灌注 4 大核心内置模板种子数据
            cursor.execute("SELECT COUNT(*) FROM document_templates")
            count = cursor.fetchone()[0]
            
            if count == 0:
                print("🌱 [SQLite-Seed] 检测到模板数据库为空，正在注入四大黄金内置专家模板种子...")
                
                default_contract = """你是一位极其严谨的资深采购与法务审计专家。请仔细审阅这份合同。你的任务是精确提取合同的核心条款，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "合同主标题",
  "parties": ["甲方公司名称", "乙方公司名称"],
  "key_dates": {"签署日期": "YYYY-MM-DD", "截止日期": "YYYY-MM-DD"},
  "amount": 100000.00,
  "currency": "CNY",
  "summary": "合同核心摘要",
  "dynamic_attributes": {"delivery_deadline": "最晚交货期", "warranty_years": "质保期"},
  "confidence_score": "high",
  "evidence": {"parties": "依据段落", "amount": "依据段落"}
}"""
                
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
                    ("contract", "合同法务专家", default_contract),
                    ("resume", "猎头与招聘总监", default_resume),
                    ("invoice", "发票财务审核", default_invoice),
                    ("other", "通用文档处理", default_other),
                ]
                
                cursor.executemany("""
                    INSERT INTO document_templates (category, display_name, prompt_template)
                    VALUES (?, ?, ?)
                """, seeds)
                conn.commit()
                print("🎉 [SQLite-Seed] 内置种子数据注入成功！")

    def list_templates(self):
        """列出所有已注册的分类模板"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT category, display_name, prompt_template FROM document_templates ORDER BY created_at ASC")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def save_template(self, category: str, display_name: str, prompt_template: str):
        """新增或更新模版提示词"""
        category = category.lower().strip()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO document_templates (category, display_name, prompt_template)
                VALUES (?, ?, ?)
                ON CONFLICT(category) DO UPDATE SET
                    display_name = excluded.display_name,
                    prompt_template = excluded.prompt_template
            """, (category, display_name.strip(), prompt_template.strip()))
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

# 实例化全局单例
db_service = DatabaseService()
