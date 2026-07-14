# -*- coding: utf-8 -*-
"""
📊 动态 SQL 编译模板（大模型两阶段路由提取模板）
通过在 SQL 框架中设置占位符，支持在 Python 运行时将本地 SQLite 的模板配置实时编译热部署进 BigQuery View。
"""

# =========================================================================
# 1. 阶段一：极速文件分类 DDL 模板 (支持根据 SQLite 注册分类动态编译)
# =========================================================================
CLASSIFIER_SQL_TEMPLATE = """
CREATE OR REPLACE VIEW `{project_id}.{dataset_id}.v_stage1_classifier` AS
SELECT
  uri,
  TRIM(ml_generate_text_llm_result) AS doc_type
FROM
  ML.GENERATE_TEXT(
    MODEL `{model_id}`,
    TABLE `{project_id}.{dataset_id}.t_object_table`,
    STRUCT(
      0.0 AS temperature,
      16 AS max_output_tokens, -- 极小 Token，极速极便宜分类
      TRUE AS flatten_json_output,
      '{prompt_classifier}' AS prompt
    )
  );
"""

# =========================================================================
# 2. 阶段二：云端多流合并热编译 DDL 模板（支持每个分类单独配置温度与Token，按流按需调用，省钱提速）
# =========================================================================
ROUTED_EXTRACTION_SQL_TEMPLATE = """
CREATE OR REPLACE VIEW `{project_id}.{dataset_id}.v_stage2_routed_extractor` AS
WITH stage1_results AS (
  SELECT uri, doc_type FROM `{project_id}.{dataset_id}.v_stage1_classifier`
),
stage2_raw_extracted AS (
  {union_clauses}
),
cleaned_results AS (
  SELECT
    uri,
    doc_type,
    REGEXP_REPLACE(
      REGEXP_REPLACE(TRIM(raw_text), r'^```(?:json)?\\s*', ''), 
      r'\\s*```$', 
      ''
    ) AS clean_json_str
  FROM
    stage2_raw_extracted
)
SELECT
  uri,
  doc_type,
  JSON_VALUE(SAFE.PARSE_JSON(clean_json_str), '$.doc_title') AS doc_title,
  SAFE.PARSE_JSON(JSON_VALUE(clean_json_str), '$.parties') AS parties,
  SAFE.PARSE_JSON(JSON_VALUE(clean_json_str), '$.key_dates') AS key_dates,
  SAFE_CAST(JSON_VALUE(clean_json_str, '$.amount') AS FLOAT64) AS amount,
  JSON_VALUE(clean_json_str, '$.currency') AS currency,
  JSON_VALUE(clean_json_str, '$.summary') AS summary,
  SAFE.PARSE_JSON(JSON_VALUE(clean_json_str), '$.dynamic_attributes') AS dynamic_attributes,
  COALESCE(JSON_VALUE(clean_json_str, '$.confidence_score'), 'high') AS confidence_score,
  SAFE.PARSE_JSON(JSON_VALUE(clean_json_str), '$.evidence') AS evidence
FROM
  cleaned_results;
"""
