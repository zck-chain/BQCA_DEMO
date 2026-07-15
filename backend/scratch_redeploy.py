# -*- coding: utf-8 -*-
import sys
import os

# 导入 BQ 和 DB 服务
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from backend.services.bq_service import BigQueryService
from backend.services.db_service import db_service

bq_service = BigQueryService()
workspace_id = "demo_001"

print("🚀 [Redeploy] 正在为隔离空间 demo_001 热重载并物理部署全新自适应 BigQuery 视图...")

try:
    # 强制以 procurement_audit 类别热更新重新部署视图
    view_name = bq_service.deploy_two_stage_extraction_views(workspace_id, selected_category="procurement_audit")
    print(f"🎯 [Success] 视图 {view_name} 已成功物理覆盖部署至 BigQuery！")
except Exception as e:
    import traceback
    traceback.print_exc()
