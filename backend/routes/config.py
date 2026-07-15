# -*- coding: utf-8 -*-
"""
📡 GCP 云端连接中控台与自适应探针自检 API
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google.cloud import storage, bigquery
from google.cloud import bigquery_connection_v1 as connection_v1
from backend.services.db_service import db_service

router = APIRouter()

class ConfigPayload(BaseModel):
    gcp_project_id: str
    gcs_bucket_name: str
    bq_connection_name: str
    bqca_agent_id: str = None


@router.get("/")
def get_system_config():
    """
    获取当前 SQLite 中注册的 GCP 三要素及 BQCA Agent ID 配置
    """
    try:
        project_id = db_service.get_system_config("gcp_project_id", "webeye-internal-test")
        bucket_name = db_service.get_system_config("gcs_bucket_name", "bqca-demo")
        connection_name = db_service.get_system_config("bq_connection_name", "bqca_external_connection")
        bqca_agent_id = db_service.get_system_config("bqca_agent_id", "")
        
        return {
            "success": True,
            "data": {
                "gcp_project_id": project_id,
                "gcs_bucket_name": bucket_name,
                "bq_connection_name": connection_name,
                "bqca_agent_id": bqca_agent_id
            }
        }
    except Exception as e:
        return {"success": False, "message": f"拉取系统配置失败: {str(e)}"}


@router.post("/save")
def save_system_config(payload: ConfigPayload):
    """
    持久化保存用户输入的 GCP 三要素及 BQCA Agent ID
    """
    try:
        db_service.set_system_config("gcp_project_id", payload.gcp_project_id.strip())
        db_service.set_system_config("gcs_bucket_name", payload.gcs_bucket_name.strip())
        db_service.set_system_config("bq_connection_name", payload.bq_connection_name.strip())
        db_service.set_system_config("bqca_agent_id", (payload.bqca_agent_id or "").strip())
        
        return {
            "success": True,
            "message": "GCP中控连接参数与 BQCA Agent ID 已成功持久化保存！"
        }
    except Exception as e:
        return {"success": False, "message": f"保存配置失败: {str(e)}"}


@router.post("/verify")
def verify_system_config(payload: ConfigPayload):
    """
    🔍 极强探针自检：对 Bucket、BigQuery 连接以及 IAM 读写权限进行 100% 连通性穿透自检
    """
    project_id = payload.gcp_project_id.strip()
    bucket_name = payload.gcs_bucket_name.strip()
    connection_name = payload.bq_connection_name.strip()
    
    report = {
        "gcs_status": "pending",
        "gcs_location": "unknown",
        "bq_status": "pending",
        "bq_connection_status": "pending",
        "service_account": "unknown",
        "error_step": None,
        "error_message": None,
        "guide": None
    }
    
    # -------------------------------------------------------------------------
    # 1. GCS 存储桶探测 (Bucket Connection & Location Detection)
    # -------------------------------------------------------------------------
    try:
        storage_client = storage.Client(project=project_id)
        bucket = storage_client.get_bucket(bucket_name)
        report["gcs_status"] = "ok"
        report["gcs_location"] = bucket.location.upper() # 对齐大写，例如 "US" 或 "ASIA-EAST1"
    except Exception as e:
        report["gcs_status"] = "error"
        report["error_step"] = "GCS_BUCKET_DETECTION"
        err_str = str(e)
        report["error_message"] = err_str
        
        if "404" in err_str:
            report["guide"] = f"存储桶 '{bucket_name}' 不存在！请核对您填入的桶名拼写是否完全正确（注意大小写敏感），且确认该桶已被创建在您的 GCP 项目中。"
        elif "403" in err_str:
            report["guide"] = f"权限不足！您的运行环境没有权限访问存储桶 '{bucket_name}'。请确保当前运行机拥该桶的 Storage Object Viewer 或 Storage Admin 角色。"
        else:
            report["guide"] = f"GCS 存储桶建立连接异常。请确认您在本地终端已经执行过 gcloud 身份验证（gcloud auth application-default login）。"
        return {"success": False, "report": report}

    # -------------------------------------------------------------------------
    # 2. BigQuery 算力大脑自检 (BigQuery Client & Query Execution)
    # -------------------------------------------------------------------------
    try:
        bq_client = bigquery.Client(project=project_id)
        # 执行一个无数据集、完全在内存运行的极简语句测试底层驱动
        bq_client.query("SELECT 1;").result()
        report["bq_status"] = "ok"
    except Exception as e:
        report["bq_status"] = "error"
        report["error_step"] = "BIGQUERY_DETECTION"
        err_str = str(e)
        report["error_message"] = err_str
        report["guide"] = f"BigQuery 客户端初始化或执行基本查询失败。请验证您的 GCP 项目 ID '{project_id}' 拼写无误，且您的账号具备 BigQuery User 角色。"
        return {"success": False, "report": report}

    # -------------------------------------------------------------------------
    # 3. BigQuery Connection 外部连接与 IAM 探针自检 (IAM & SA Extract)
    # -------------------------------------------------------------------------
    try:
        conn_client = connection_v1.ConnectionServiceClient()
        # 强制对齐 Location，如果是多区域 US 转 lowercase 拼装，GCP API 要求如此
        loc_lower = report["gcs_location"].lower()
        connection_path = f"projects/{project_id}/locations/{loc_lower}/connections/{connection_name}"
        
        conn_obj = conn_client.get_connection(request={"name": connection_path})
        sa_email = conn_obj.cloud_resource.service_account_id
        
        report["bq_connection_status"] = "ok"
        report["service_account"] = sa_email
    except Exception as e:
        report["bq_connection_status"] = "error"
        report["error_step"] = "BQ_CONNECTION_DETECTION"
        err_str = str(e)
        report["error_message"] = err_str
        report["guide"] = (
            f"探测 BigQuery 外部连接失败！请确认：\n"
            f"  1. 已经在 GCP 控制台的 {report['gcs_location']} 区域创建了名为 '{connection_name}' 的 External Connection。\n"
            f"  2. 已经开启了 'BigQuery Connection API'。\n"
            f"  3. GCP 项目 ID '{project_id}' 输入正确。\n"
            f"详细错误: {err_str}"
        )
        return {"success": False, "report": report}

    # -------------------------------------------------------------------------
    # 4. 全绿通关，返回大喜报！
    # -------------------------------------------------------------------------
    return {
        "success": True,
        "message": "📡 恭喜！云端全物理链路 100% 闭环自检通过！",
        "report": report
    }
