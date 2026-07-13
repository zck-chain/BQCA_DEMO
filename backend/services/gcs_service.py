# -*- coding: utf-8 -*-
"""
📂 Google Cloud Storage (GCS) 服务编排层
核心职责：
  1. 为用户空间开辟云端物理隔离子目录。
  2. 签署 V4 Signed URL，协助前端将二进制文件极速、安全、零中转带宽消耗直传至 GCS。
"""

import datetime
from google.cloud import storage
from backend import config


class GCSService:
    def __init__(self):
        self.client = storage.Client(project=config.PROJECT_ID)
        self.bucket_name = config.GLOBAL_STORAGE_BUCKET

    def create_user_workspace_folder(self, workspace_id: str) -> str:
        """
        1. 在云端大平层桶下，通过写入虚拟占位符，为该空间划分专有物理子目录。
        """
        bucket = self.client.bucket(self.bucket_name)
        folder_prefix = f"workspaces/{workspace_id}/"
        blob = bucket.blob(f"{folder_prefix}.placeholder")
        blob.upload_from_string(b"workspace_init")
        return f"gs://{self.bucket_name}/{folder_prefix}"

    def generate_v4_upload_signed_url(self, workspace_id: str, filename: str, content_type: str) -> dict:
        """
        2. 【核心亮点】签署具有 15 分钟时效的安全 V4 上传临时凭证。
           前端获得后直接 PUT 二进制流，消除 Python 后端中转带宽瓶颈！
        """
        bucket = self.client.bucket(self.bucket_name)
        blob_path = f"workspaces/{workspace_id}/{filename}"
        blob = bucket.blob(blob_path)

        url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(minutes=15),
            method="PUT",
            content_type=content_type
        )
        return {
            "upload_url": url,
            "gcs_uri": f"gs://{self.bucket_name}/{blob_path}"
        }

    def list_files_in_workspace(self, workspace_id: str) -> list:
        """
        3. 列举当前空间 GCS 子目录下的所有已直传文件。
        """
        bucket = self.client.bucket(self.bucket_name)
        prefix = f"workspaces/{workspace_id}/"
        blobs = self.client.list_blobs(bucket, prefix=prefix)

        files = []
        for blob in blobs:
            # 过滤占位符文件
            if blob.name.endswith(".placeholder"):
                continue
            filename = blob.name.replace(prefix, "")
            files.append({
                "filename": filename,
                "size_bytes": blob.size,
                "gcs_uri": f"gs://{self.bucket_name}/{blob.name}"
            })
        return files
