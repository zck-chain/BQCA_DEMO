# -*- coding: utf-8 -*-
"""
🚀 无界 AI 智能网盘转换工具 —— 核心 API 后台启动入口
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routes import file, workspace, template, config

app = FastAPI(
    title="无界 AI 智能网盘转换工具 —— API 引擎",
    description="Python FastAPI 后台：提供 GCS 签名直传、BigQuery 动态参数热编译、人工核对语义建表及 BQCA 智能体一键绑定服务。",
    version="1.0.0"
)

# -------------------------------------------------------------------------
# CORS 跨域安全配置
# 开启本地开发平层跨域，允许前端 index.html 即使双击在浏览器中直接打开，
# 也能毫无阻碍、极其流畅地与本地启动的 localhost:8000 进行接口联调交互！
# -------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许任意域跨域联调
    allow_credentials=True,
    allow_methods=["*"],  # 允许任意请求动词（GET, POST, PUT, DELETE）
    allow_headers=["*"],  # 允许任意自定义标头
)

# -------------------------------------------------------------------------
# 路由模块注册
# -------------------------------------------------------------------------
app.include_router(file.router)
app.include_router(workspace.router)
app.include_router(template.router, prefix="/api/templates")
app.include_router(config.router, prefix="/api/config")


@app.on_event("startup")
def startup_event():
    """
    FastAPI 启动钩子：在后台独立线程中执行 BQ 自愈初始化
    保证 ASGI 接口进程秒级无阻碍启动，并在 10-15 秒内自动打通 GCP 环境注册。
    """
    try:
        from backend.routes.workspace import bq_service
        import threading
        print("🧬 [Startup] 正在后台启动 BigQuery 共享资源与自愈环境注册线程...")
        threading.Thread(target=bq_service.ensure_shared_assets_exist, daemon=True).start()
    except Exception as e:
        print(f"⚠️ [Startup Error] 启动初始化自愈配置线程失败: {str(e)}")



# -------------------------------------------------------------------------
# 静态资源挂载与容器化部署支持
# -------------------------------------------------------------------------
import os
from fastapi.staticfiles import StaticFiles

@app.get("/health", summary="测试服务可用性状态灯")
def root_health_check():
    return {
        "status": "healthy",
        "service": "AI Netdisk Analytics Engine",
        "framework": "FastAPI"
    }

# 🚀 【全栈单容器热部署】若检测到 frontend 目录存在，自动将其挂载为根目录静态托管
# 这将使得前端与后端同域部署，完全规避 CORS 跨域问题，并且支持单个 Cloud Run 实例全栈起飞！
if os.path.exists("frontend"):
    print("🎨 [Frontend-Host] 检测到本地前端资源目录，自动启动全托管静态网页服务 ── 开启一键单镜像极速部署模式 ！！！")
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


if __name__ == "__main__":
    # 本地启动：热重载监听 localhost:8000
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
