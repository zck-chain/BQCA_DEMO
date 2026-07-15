# -*- coding: utf-8 -*-
"""
⚙️ SaaS 平台统一环境变量与 GCP 连接池全局配置 (Global CONFIG)
核心设计：
  自适应适配用户的 GCP 账户与多区域 (us) 预授权连接及 Gemini 2.5 Flash 模型。
"""

import os
import google.auth

# 1. 自动探测当前开发机上激活的 GCP 项目 ID (ADC / gcloud)
try:
    credentials, detected_project = google.auth.default()
    if not detected_project:
        detected_project = "webeye-internal-test"
except Exception:
    detected_project = "webeye-internal-test"

PROJECT_ID = os.getenv("GCP_PROJECT", detected_project)
LOCATION = os.getenv("GCP_LOCATION", "US")                          # 更改为多区域 US，匹配用户的连接和数据集区域

# 2. 预先配置好的大模型资源 ID (在 BigQuery ML 注册的 Gemini Pro/Flash 模型对象)
SHARED_DATASET = "workspace_shared_connection"
GEMINI_MODEL_ID = f"{PROJECT_ID}.{SHARED_DATASET}.gemini_flash_model"

# 3. 核心大平层预授权存储桶 (所有空间的上传文件均在此桶的子文件夹隔离存放)
GLOBAL_STORAGE_BUCKET = os.getenv("GCS_BUCKET", "bqca-demo")

# 4. 【平层预授权】系统部署时预先在谷歌控制台打通的 BigQuery 外部连接 Connection ID
# 精准打通并适配用户的多区域 'bqca_external_connection' 外部连接！
GLOBAL_BQ_CONNECTION = f"projects/{PROJECT_ID}/locations/{LOCATION}/connections/bqca_external_connection"


# -------------------------------------------------------------------------
# 🚀 运行时动态配置加载 Helper (支持热插拔、热更新)
# -------------------------------------------------------------------------
def get_project_id() -> str:
    from backend.services.db_service import db_service
    return db_service.get_system_config("gcp_project_id", PROJECT_ID)

def get_storage_bucket() -> str:
    from backend.services.db_service import db_service
    return db_service.get_system_config("gcs_bucket_name", GLOBAL_STORAGE_BUCKET)

def get_connection_name() -> str:
    from backend.services.db_service import db_service
    return db_service.get_system_config("bq_connection_name", "bqca_external_connection")

def get_bq_connection(location: str = None) -> str:
    loc = (location or LOCATION).lower()
    return f"projects/{get_project_id()}/locations/{loc}/connections/{get_connection_name()}"

def get_bqca_agent_id() -> str:
    from backend.services.db_service import db_service
    return db_service.get_system_config("bqca_agent_id", "")

def get_gemini_model_id() -> str:
    return f"{get_project_id()}.{SHARED_DATASET}.gemini_flash_model"

# Reload trigger comment

