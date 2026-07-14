# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from backend.services.db_service import db_service

router = APIRouter()

class TemplateSavePayload(BaseModel):
    category: str
    display_name: str
    prompt_template: str
    temperature: Optional[float] = 0.1
    max_output_tokens: Optional[int] = 1024
    top_p: Optional[float] = 0.95
    response_mime_type: Optional[str] = "application/json"

@router.get("/list")
async def get_templates():
    """获取所有支持的文件分类和提示词模板以及关联的大模型参数"""
    try:
        templates = db_service.list_templates()
        return {"success": True, "data": templates}
    except Exception as e:
        return {"success": False, "message": f"获取模板列表异常: {str(e)}"}

@router.post("/save")
async def save_template(payload: TemplateSavePayload):
    """保存或新增分类模板"""
    try:
        db_service.save_template(
            category=payload.category,
            display_name=payload.display_name,
            prompt_template=payload.prompt_template,
            temperature=payload.temperature if payload.temperature is not None else 0.1,
            max_output_tokens=payload.max_output_tokens if payload.max_output_tokens is not None else 1024,
            top_p=payload.top_p if payload.top_p is not None else 0.95,
            response_mime_type=payload.response_mime_type if payload.response_mime_type is not None else "application/json"
        )
        return {"success": True, "message": f"模板 {payload.category} 保存成功！"}
    except Exception as e:
        return {"success": False, "message": f"保存模板异常: {str(e)}"}

@router.delete("/{category}")
async def delete_template(category: str):
    """删除自定义分类模板"""
    try:
        db_service.delete_template(category)
        return {"success": True, "message": f"模板 {category} 删除成功！"}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        return {"success": False, "message": f"删除模板异常: {str(e)}"}
