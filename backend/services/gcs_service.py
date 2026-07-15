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
    @property
    def client(self):
        # 运行时动态获取当前生效的项目ID实例化，实现配置零重启热插拔
        return storage.Client(project=config.get_project_id())

    @property
    def bucket_name(self):
        # 运行时动态加载当前生效的存储桶名（如 zck_test），实现动态切换
        return config.get_storage_bucket()

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
           支持中文转安全 ASCII 随机名并按日期（/年/月/日）进行物理目录隔离。
        """
        import uuid
        import os

        now = datetime.datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%m")
        day = now.strftime("%d")
        
        _, ext = os.path.splitext(filename)
        random_name = f"{uuid.uuid4().hex}{ext}"
        
        bucket = self.client.bucket(self.bucket_name)
        blob_path = f"workspaces/{workspace_id}/{year}/{month}/{day}/{random_name}"
        blob = bucket.blob(blob_path)

        try:
            # 签署带有 x-goog-meta 元数据头的文件，防止中文直接传输导致链接失效或报错
            headers = {"x-goog-meta-original-filename": filename.encode('utf-8').decode('latin-1')}
            url = blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=15),
                method="PUT",
                content_type=content_type,
                headers=headers
            )
            return {
                "upload_url": url,
                "gcs_uri": f"gs://{self.bucket_name}/{blob_path}",
                "fallback_upload": False
            }
        except Exception as e:
            print(f"⚠️ [GCS-Sign-Fallback] 探测到本地运行环境不具备 V4 签名权限 (如 UserCredentials 用户模式): {str(e)}")
            print("   ↳ 自动激活自愈安全中转通道进行本地中转上传，确保 100% 顺畅体验！")
            return {
                "upload_url": f"/api/files/upload-fallback?workspace_id={workspace_id}",
                "gcs_uri": f"gs://{self.bucket_name}/{blob_path}",
                "fallback_upload": True
            }

    async def upload_file_direct(self, workspace_id: str, file) -> str:
        """
        GCS 签名失效时的自愈安全中转：通过本地 API 读取二进制文件流并写回 GCS，
        支持中文转安全 ASCII 随机名并按日期（/年/月/日）进行物理目录隔离。
        """
        import uuid
        import os
        
        now = datetime.datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%m")
        day = now.strftime("%d")
        
        original_filename = file.filename
        _, ext = os.path.splitext(original_filename)
        random_name = f"{uuid.uuid4().hex}{ext}"
        
        bucket = self.client.bucket(self.bucket_name)
        blob_path = f"workspaces/{workspace_id}/{year}/{month}/{day}/{random_name}"
        blob = bucket.blob(blob_path)
        
        # 写入原始中文名作为元数据，并在 GCS 完美的进行物理落盘
        blob.metadata = {"original_filename": original_filename}
        
        # 异步读取文件内容并直传
        content = await file.read()
        blob.upload_from_string(content, content_type=file.content_type)
        return f"gs://{self.bucket_name}/{blob_path}"

    def list_files_in_workspace(self, workspace_id: str) -> list:
        """
        3. 列举当前空间 GCS 子目录下的所有已直传文件（智能感知和提取元数据中的中文文件名）。
           支持同时返回中文名称、实际物理文件名以及 GCS 相对路径。
        """
        import os
        bucket = self.client.bucket(self.bucket_name)
        prefix = f"workspaces/{workspace_id}/"
        blobs = self.client.list_blobs(bucket, prefix=prefix)

        files = []
        for blob in blobs:
            # 过滤占位符文件
            if blob.name.endswith(".placeholder"):
                continue
                
            # 拉取完整元数据以读取 custom metadata 属性
            try:
                blob.reload()
                original_filename = blob.metadata.get("original_filename") if blob.metadata else None
            except Exception:
                original_filename = None
                
            # 获取实际物理文件名（尾部）和相对 GCS 目录路径
            physical_name = os.path.basename(blob.name)
            gcs_path = blob.name.replace(prefix, "")
            
            # 如果没有元数据，降级优雅地提取其路径尾部文件名作为展示名
            if not original_filename:
                original_filename = physical_name
                
            files.append({
                "filename": original_filename,
                "physical_name": physical_name,
                "gcs_path": gcs_path,
                "size_bytes": blob.size,
                "gcs_uri": f"gs://{self.bucket_name}/{blob.name}"
            })
        return files
