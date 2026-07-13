# -*- coding: utf-8 -*-
"""
📂 模块化路由器：GCS 签名直传与文件列表管理
核心职责：
  1. 为前端拖拽直传签发有时效性的 V4 Upload Signed URL。
  2. 获取某个特定空间已上传至 GCS 存储桶中的源文件列表。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.services.gcs_service import GCSService

router = APIRouter(prefix="/api/files", tags=["GCS云盘直传管理"])
gcs_service = GCSService()


# -------------------------------------------------------------------------
# 1. 签名直传 API 交互 DTO
# -------------------------------------------------------------------------
class SignedUrlRequest(BaseModel):
    workspace_id: str
    filename: str
    content_type: str


@router.post("/signed-url", summary="【高并发零中转】申请有时效的 V4 Upload Signed URL 安全直传凭证")
def get_upload_signed_url(payload: SignedUrlRequest):
    """
    当用户拖拽文件到前端时：
    1. 触发此路由，向谷歌云 Storage 签署临时凭证。
    2. 返回给前端 URL，前端以 PUT 方式直传二进制，消除高并发中转瓶颈。
    """
    try:
        data = gcs_service.generate_v4_upload_signed_url(
            workspace_id=payload.workspace_id,
            filename=payload.filename,
            content_type=payload.content_type
        )
        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成上传证书失败: {str(e)}")


# -------------------------------------------------------------------------
# 2. 列举上传文件接口
# -------------------------------------------------------------------------
@router.get("/list/{workspace_id}", summary="列举当前空间已直传在 GCS 的全部原始文件")
def list_uploaded_files(workspace_id: str):
    try:
        files = gcs_service.list_files_in_workspace(workspace_id)
        return {"success": True, "data": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询原始文件列表异常: {str(e)}")
