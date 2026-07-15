/* =========================================================================
   💎 无界 AI 智能网盘转换工具 —— 前端核心业务逻辑
   Features: Signed URL 直传、大模型参数本地缓存与热配置、双屏核对、一键建表与 BQCA 激活
   ========================================================================= */

const API_BASE = "http://127.0.0.1:8000";

// -------------------------------------------------------------------------
// 1. 默认金牌提示词预设 (用于重置或缺省加载)
// -------------------------------------------------------------------------
const DEFAULT_PRESETS = {
    temperature: 0.1,
    max_output_tokens: 1024,
    prompt_contract: `你是一位极其严谨的资深采购与法务审计专家。请仔细审阅这份合同。
你的任务是精准提取合同的核心条款，严格以标准的纯 JSON 格式输出（不要带有 \`\`\`json 外壳），格式如下：
{
  "doc_title": "合同主标题",
  "parties": ["甲方公司名称", "乙方公司名称"],
  "key_dates": {"签署日期": "YYYY-MM-DD", "截止日期": "YYYY-MM-DD"},
  "amount": 100000.00,
  "currency": "CNY",
  "summary": "合同核心采购标的和履约责任摘要（100字内）",
  "dynamic_attributes": {
    "delivery_deadline": "最晚交货期限",
    "warranty_years": "质保年限"
  },
  "confidence_score": "high",
  "evidence": {
    "parties": "提取甲乙方的合同原文依据",
    "amount": "提取金额的合同原文依据"
  }
}`,
    prompt_resume: `你是一位眼光极其毒辣的资深猎头和 HR 总监。请仔细阅读并评估这份求职简历。
你的任务是精准提取候选人属性，严格以标准的纯 JSON 格式输出（不要带有 \`\`\`json 外壳），格式如下：
{
  "doc_title": "候选人姓名_求职简历",
  "parties": ["候选人姓名", "最近任职公司名称"],
  "key_dates": {"最近入职时间": "YYYY-MM-DD"},
  "amount": null,
  "currency": "CNY",
  "summary": "候选人核心竞争力和一句话评价摘要（100字内）",
  "dynamic_attributes": {
    "job_title": "求职岗位",
    "experience_years": "工作年限（数字）",
    "skills": "核心技术栈列表（用逗号隔开）"
  },
  "confidence_score": "high",
  "evidence": {
    "skills": "提取技能的原文依据"
  }
}`,
    prompt_invoice: `你是一位高标准、严要求的资深财务出纳与税务专家。请核对这张发票。
你的任务是精准提取财务合规字段，严格以标准的纯 JSON 格式输出（不要带有 \`\`\`json 外壳），格式如下：
{
  "doc_title": "发票_开票方名称",
  "parties": ["销售方/开票方公司名称", "购买方/付款方公司名称"],
  "key_dates": {"开票日期": "YYYY-MM-DD"},
  "amount": 5000.00,
  "currency": "CNY",
  "summary": "发票开具的主要商品或服务内容摘要（100字内）",
  "dynamic_attributes": {
    "invoice_code": "发票号码",
    "tax_amount": "税额",
    "tax_rate": "税率"
  },
  "confidence_score": "high",
  "evidence": {
    "amount": "提取发票金额的原文印证"
  }
}`,
    prompt_other: `你是一个全能商业文档助理。请阅读文件并做最简总结，严格以标准的纯 JSON 格式输出（不要带有 \`\`\`json 外壳），格式如下：
{
  "doc_title": "文件主标题",
  "parties": ["主要机构或人名"],
  "key_dates": {"关联日期": "YYYY-MM-DD"},
  "amount": null,
  "currency": "CNY",
  "summary": "文件一句话核心内容摘要",
  "dynamic_attributes": {
    "document_purpose": "该文件的主要用途或目的说明"
  },
  "confidence_score": "high",
  "evidence": {}
}`
};

// -------------------------------------------------------------------------
// 2. 全局状态变量
// -------------------------------------------------------------------------
let currentWorkspace = null;
let uploadedFiles = [];
let analysisResults = [];
let isAnalyzing = false;

// -------------------------------------------------------------------------
// 2.5 极致动效 Glassmorphic 提示框系统 (Premium Toast)
// -------------------------------------------------------------------------
function showToast(title, message, type = "success", duration = 4000) {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast-card toast-${type}`;
    
    let icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-xmark";
    else if (type === "warning") icon = "fa-triangle-exclamation";
    else if (type === "info") icon = "fa-circle-info";
    else if (type === "loading") icon = "fa-spinner fa-spin";

    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fa-solid ${icon}"></i>
        </div>
        <div class="toast-body">
            <h4 class="toast-title">${title}</h4>
            <p class="toast-msg">${message}</p>
        </div>
        <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    const closeBtn = toast.querySelector(".toast-close");
    closeBtn.addEventListener("click", () => {
        dismissToast(toast);
    });

    if (type !== "loading") {
        const progressBar = toast.querySelector(".toast-progress");
        progressBar.style.animation = `toast-progress-anim ${duration}ms linear forwards`;
        setTimeout(() => {
            dismissToast(toast);
        }, duration);
    }

    return toast;
}

function dismissToast(toast) {
    if (!toast) return;
    toast.classList.add("toast-leaving");
    toast.addEventListener("animationend", () => {
        toast.remove();
    });
}

// -------------------------------------------------------------------------
// 3. UI 元素抓取
// -------------------------------------------------------------------------
const btnNewSpace = document.getElementById("btn-new-space");
const btnTriggerAnalyze = document.getElementById("btn-trigger-analyze");
const workspaceList = document.getElementById("workspace-list");
const netdiskFileList = document.getElementById("netdisk-file-list");
const analysisTableBody = document.getElementById("analysis-table-body");
const currentSpaceTitle = document.getElementById("current-space-title");
const currentSpaceDesc = document.getElementById("current-space-desc");
const dropzone = document.getElementById("dropzone");

// 弹窗元素
const spaceModal = document.getElementById("space-modal");
const btnCancelCreate = document.getElementById("btn-cancel");
const btnConfirmCreate = document.getElementById("btn-confirm-create");
const inputSpaceId = document.getElementById("input-space-id");
const inputSpaceName = document.getElementById("input-space-name");
const modalClose = document.getElementById("modal-close");

// HIL 侧边栏审核元素
const reviewSheet = document.getElementById("review-sheet");
const sheetClose = document.getElementById("sheet-close");
const btnHilCancel = document.getElementById("btn-hil-cancel");
const btnHilSubmit = document.getElementById("btn-hil-submit");
const evidenceContainer = document.getElementById("evidence-container");

// BQCA 智脑浮窗
const bqcaWidget = document.getElementById("bqca-widget");
const bqcaToggle = document.getElementById("bqca-toggle");
const bqcaChatBox = document.getElementById("bqca-chat-box");
const chatCloseBtn = document.getElementById("chat-close-btn");
const bqcaInput = document.getElementById("bqca-input");
const btnSendChat = document.getElementById("btn-send-chat");
const bqcaMessages = document.getElementById("bqca-messages");

// =========================================================================
// 4. 初始化加载：空间与本地配置缓存 (LocalStorage Caching)
// =========================================================================
window.addEventListener("DOMContentLoaded", async () => {
    // 4.1 自动生成并插入大模型高级可折叠面板
    injectConfigPanelToHeader();
    
    // 4.2 动态从本地 SQLite 数据库加载分类模板，并进行 UI 渲染
    await fetchTemplates();
    loadLocalConfigFromCache();

    // 4.3 初始化默认演示空间
    initializeDefaultWorkspace();
});

let loadedTemplates = [];
let currentActiveCategory = "procurement_audit"; // 默认直接靶向高亮在最关心的采购法务专家上

async function fetchTemplates() {
    try {
        const res = await fetch(`${API_BASE}/api/templates/list`);
        const result = await res.json();
        if (result.success) {
            loadedTemplates = result.data;
            if (loadedTemplates.length > 0) {
                // 如果当前类别没有初始化，或者是不在当前加载的模板列表中，默认指向第一个具体专科
                const exists = loadedTemplates.some(t => t.category === currentActiveCategory);
                if (!exists) {
                    currentActiveCategory = loadedTemplates[0].category;
                }
            }
            renderTemplatesUI();
        }
    } catch (e) {
        console.error("无法加载大模型配置模板列表", e);
    }
}

function renderTemplatesUI() {
    const tabTriggers = document.getElementById("tab-triggers");
    const tabContents = document.getElementById("tab-contents");
    if (!tabTriggers || !tabContents) return;

    tabTriggers.innerHTML = "";
    tabContents.innerHTML = "";

    // 🚀 【极致洁癖纯净化】：完全遵照用户指令下线阶段一自动分类器卡片，100% 走纯靶向专家卡片提取
    const allTemplates = [...loadedTemplates];

    allTemplates.forEach((t, idx) => {
        const btn = document.createElement("button");
        // 判定当前选中的 Active Tab
        const isSelected = t.category === currentActiveCategory;
        btn.className = `sec-btn ${isSelected ? "active" : ""}`;
        btn.innerHTML = `<i class="fa-solid fa-brain" style="font-size: 10px; opacity: 0.8; margin-right: 4px;"></i> ${t.display_name}`;
        btn.onclick = () => switchPromptTab(t.category);
        btn.id = `tab-btn-${t.category}`;
        tabTriggers.appendChild(btn);

        // 渲染对应模板面板内容容器
        const div = document.createElement("div");
        div.id = `tab-content-${t.category}`;
        div.className = isSelected ? "" : "hidden";
        
        const textarea = document.createElement("textarea");
        textarea.id = `prompt-area-${t.category}`;
        textarea.rows = 8;
        textarea.style.width = "100%";
        textarea.style.background = "rgba(0,0,0,0.2)";
        textarea.style.border = "1px solid var(--border-color)";
        textarea.style.color = "#fff";
        textarea.style.fontFamily = "monospace";
        textarea.style.fontSize = "12px";
        textarea.style.padding = "12px";
        textarea.style.borderRadius = "8px";
        textarea.value = t.prompt_template;
        if (t.category === "auto") {
            textarea.readOnly = true;
            textarea.style.opacity = "0.7";
            textarea.style.borderStyle = "dashed";
        }

        // =========================================================================
        // 🎛️ 模型高级超参数配置区 (MIME Type / Temperature / Top P / Max Tokens)
        // =========================================================================
        const hpDiv = document.createElement("div");
        hpDiv.style.background = "rgba(255,255,255,0.02)";
        hpDiv.style.border = "1px dashed var(--border-color)";
        hpDiv.style.borderRadius = "8px";
        hpDiv.style.padding = "12px";
        hpDiv.style.marginTop = "12px";
        hpDiv.style.marginBottom = "4px";
        hpDiv.style.display = "grid";
        hpDiv.style.gridTemplateColumns = "repeat(2, 1fr)";
        hpDiv.style.gap = "16px";

        if (t.category === "auto") {
            // Auto 状态下显示高端分发提示，替代滑块超参
            hpDiv.style.gridTemplateColumns = "1fr";
            hpDiv.innerHTML = `
                <div style="font-size: 11.5px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; line-height: 1.5; padding: 4px;">
                    <i class="fa-solid fa-circle-info" style="color: var(--primary-color); font-size: 14px;"></i>
                    <span>全自动分流模式下，后端引擎会根据 <strong>“合同法务”</strong>、<strong>“猎头简历”</strong>、<strong>“发票财务”</strong> 等各分类在 SQLite 里配置的个性化温度和提示词自动流转，在此无需设定单一超参。</span>
                </div>
            `;
        } else {
            // 1. Top-P (Slider)
            const topPContainer = document.createElement("div");
            topPContainer.style.display = "flex";
            topPContainer.style.flexDirection = "column";
            topPContainer.style.gap = "6px";

            const topPLabelWrapper = document.createElement("div");
            topPLabelWrapper.style.display = "flex";
            topPLabelWrapper.style.justifyContent = "space-between";
            topPLabelWrapper.style.fontSize = "11px";
            topPLabelWrapper.style.color = "var(--text-muted)";
            topPLabelWrapper.innerHTML = `<span><i class="fa-solid fa-wind" style="color: #74b9ff; margin-right: 3px;"></i> Top P (多样性)</span><span id="topp-val-${t.category}" style="color: #64ffda; font-family: monospace;">${t.top_p ?? 0.95}</span>`;

            const topPSlider = document.createElement("input");
            topPSlider.type = "range";
            topPSlider.min = "0.0";
            topPSlider.max = "1.0";
            topPSlider.step = "0.05";
            topPSlider.value = t.top_p ?? 0.95;
            topPSlider.style.width = "100%";
            topPSlider.style.cursor = "pointer";
            topPSlider.style.accentColor = "var(--primary-color)";
            topPSlider.oninput = (e) => {
                document.getElementById(`topp-val-${t.category}`).innerText = parseFloat(e.target.value).toFixed(2);
            };

            topPContainer.appendChild(topPLabelWrapper);
            topPContainer.appendChild(topPSlider);

            // 2. Response MIME Type (Dropdown)
            const mimeContainer = document.createElement("div");
            mimeContainer.style.display = "flex";
            mimeContainer.style.flexDirection = "column";
            mimeContainer.style.gap = "6px";

            const mimeLabel = document.createElement("div");
            mimeLabel.style.fontSize = "11px";
            mimeLabel.style.color = "var(--text-muted)";
            mimeLabel.innerHTML = `<span><i class="fa-solid fa-file-code" style="color: #a29bfe; margin-right: 3px;"></i> Output Format (输出响应格式)</span>`;

            const mimeSelect = document.createElement("select");
            mimeSelect.style.background = "rgba(0,0,0,0.3)";
            mimeSelect.style.border = "1px solid var(--border-color)";
            mimeSelect.style.borderRadius = "4px";
            mimeSelect.style.color = "#fff";
            mimeSelect.style.fontSize = "11px";
            mimeSelect.style.padding = "4px";
            mimeSelect.style.outline = "none";
            mimeSelect.style.cursor = "pointer";
            mimeSelect.style.marginTop = "1px";

            const mimeOptions = [
                { value: "application/json", text: "JSON 结构化 (支持入库 BigQuery)" },
                { value: "text/plain", text: "纯文本输出 (常规长文提取)" }
            ];
            mimeOptions.forEach(opt => {
                const o = document.createElement("option");
                o.value = opt.value;
                o.text = opt.text;
                if (opt.value === (t.response_mime_type ?? "application/json")) {
                    o.selected = true;
                }
                mimeSelect.appendChild(o);
            });

            mimeContainer.appendChild(mimeLabel);
            mimeContainer.appendChild(mimeSelect);

            hpDiv.appendChild(topPContainer);
            hpDiv.appendChild(mimeContainer);
        }
        
        // 控制面板
        const ctrlDiv = document.createElement("div");
        ctrlDiv.style.display = "flex";
        ctrlDiv.style.justifyContent = "space-between";
        ctrlDiv.style.marginTop = "12px";
        
        if (t.category !== "auto") {
            const saveBtn = document.createElement("button");
            saveBtn.className = "sec-btn";
            saveBtn.style.borderColor = "var(--primary-color)";
            saveBtn.style.color = "var(--primary-color)";
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 保存模板修改`;
            saveBtn.onclick = async () => {
                saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在保存...`;
                const topPSlider = hpDiv.querySelector("input[type=range]");
                const mimeSelect = hpDiv.querySelector("select");
                const toppVal = topPSlider ? parseFloat(topPSlider.value) : 0.95;
                const mimeVal = mimeSelect ? mimeSelect.value : "application/json";
                
                const tempVal = t.temperature ?? 0.1;
                const tokensVal = t.max_output_tokens ?? 1024;
                
                const success = await saveTemplateToBackend(
                    t.category, 
                    t.display_name, 
                    textarea.value,
                    tempVal,
                    tokensVal,
                    toppVal,
                    mimeVal
                );
                if (success) {
                    showToast("保存成功", `模版 <strong>${t.display_name}</strong> 的修改已持久化落库 SQLite！`, "success");
                    t.prompt_template = textarea.value;
                    t.temperature = tempVal;
                    t.max_output_tokens = tokensVal;
                    t.top_p = toppVal;
                    t.response_mime_type = mimeVal;
                } else {
                    showToast("保存失败", "保存模版及模型超参至后台数据库失败！", "error");
                }
                saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 保存模板修改`;
            };
            ctrlDiv.appendChild(saveBtn);
            
            // 允许删除非系统内置核心分类
            if (!["contract", "resume", "invoice", "other"].includes(t.category)) {
                const delBtn = document.createElement("button");
                delBtn.className = "sec-btn";
                delBtn.style.borderColor = "var(--accent-pink)";
                delBtn.style.color = "var(--accent-pink)";
                delBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> 删除此分类`;
                delBtn.onclick = async () => {
                    if (confirm(`确定要物理删除 "${t.display_name}" 分类模板吗？这将从数仓逻辑中彻底移除该路由！`)) {
                        const success = await deleteTemplateFromBackend(t.category);
                        if (success) {
                            showToast("删除分类成功", `分类模板 <strong>${t.display_name}</strong> 已安全移除。`, "success");
                            await fetchTemplates();
                        } else {
                            showToast("删除分类失败", "删除分类模板失败！", "error");
                        }
                    }
                };
                ctrlDiv.appendChild(delBtn);
            }
        }
        
        div.appendChild(textarea);
        div.appendChild(hpDiv);
        div.appendChild(ctrlDiv);
        tabContents.appendChild(div);
    });

    // 渲染 "+ 新增分类" 按钮
    const addBtn = document.createElement("button");
    addBtn.className = "sec-btn";
    addBtn.style.borderColor = "#64ffda";
    addBtn.style.color = "#64ffda";
    addBtn.innerHTML = `<i class="fa-solid fa-plus-circle"></i> 新增分类`;
    addBtn.onclick = () => document.getElementById("template-modal").classList.remove("hidden");
    tabTriggers.appendChild(addBtn);
}

async function saveTemplateToBackend(category, display_name, prompt_template, temperature = 0.1, max_output_tokens = 1024, top_p = 0.95, response_mime_type = "application/json") {
    try {
        const res = await fetch(`${API_BASE}/api/templates/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                category,
                display_name,
                prompt_template,
                temperature,
                max_output_tokens,
                top_p,
                response_mime_type
            })
        });
        const result = await res.json();
        return result.success;
    } catch (e) {
        console.error(e);
        return false;
    }
}

async function deleteTemplateFromBackend(category) {
    try {
        const res = await fetch(`${API_BASE}/api/templates/${category}`, {
            method: "DELETE"
        });
        const result = await res.json();
        return result.success;
    } catch (e) {
        console.error(e);
        return false;
    }
}

function injectConfigPanelToHeader() {
    const header = document.querySelector(".main-header");
    const panelHtml = `
        <!-- =================================================================
             模块A：大模型提取高级参数配置折叠面板
             ================================================================= -->
        <div class="collapsible-config-wrapper" style="width: 100%; margin-top: 16px; margin-bottom: 12px;">
            <div class="config-trigger" id="config-panel-toggle" style="cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--primary-color); font-weight: 600;">
                <i class="fa-solid fa-sliders"></i> ⚙️ 展开大模型提取高级参数配置（温度、最大Token与提示词热插拔）
                <i class="fa-solid fa-chevron-down" id="config-chevron"></i>
            </div>
            <div class="config-panel-body hidden" id="config-panel-body" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 20px; border-radius: 12px; margin-top: 12px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 16px;">
                    <div class="form-group">
                        <label>提取温度 (Temperature): <span id="val-temp" style="color:var(--accent-pink);">0.1</span></label>
                        <input type="range" id="input-temp" min="0.0" max="1.0" step="0.1" value="0.1" style="width:100%;">
                        <span style="font-size:11px; color:var(--text-muted);">0.0 表示极致严谨提取，适合财务法务；1.0 表示发散思维。</span>
                    </div>
                    <div class="form-group">
                        <label>单文件最大返回 Token (Max Tokens):</label>
                        <select id="input-tokens" style="background: #0f1124; border:1px solid var(--border-color); color:#fff; padding:10px; border-radius:8px;">
                            <option value="512">512 (节省费用)</option>
                            <option value="1024" selected>1024 (标准大宽表)</option>
                            <option value="2048">2048 (极复杂长文审计)</option>
                        </select>
                    </div>
                </div>
                
                <div class="prompt-tabs-container">
                    <label style="font-size:12px; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">自适应提示词热插拔及自定义分类模版：</label>
                    <div class="tab-triggers" id="tab-triggers" style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                        <!-- 动态渲染 Tab 按钮 -->
                    </div>
                    <div class="tab-contents" id="tab-contents">
                        <!-- 动态渲染 Textarea 与保存按钮 -->
                    </div>
                </div>
            </div>
        </div>

        <!-- =================================================================
             模块B：📡 GCP 云端存储与 BigQuery 物理连接设置中控台
             ================================================================= -->
        <div class="collapsible-config-wrapper gcp-config-wrapper" style="width: 100%; margin-top: 12px; margin-bottom: 24px;">
            <div class="config-trigger" id="gcp-panel-toggle" style="cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--primary-color); font-weight: 600;">
                <i class="fa-solid fa-satellite-dish"></i> 📡 展开 GCP 云端存储与 BigQuery 物理连接设置（支持存储桶 zck_test 动态热切换）
                <i class="fa-solid fa-chevron-down" id="gcp-chevron"></i>
                <span id="gcp-probe-status-pill" style="font-size: 11px; margin-left: auto; padding: 2px 8px; border-radius: 12px; background: rgba(255,255,255,0.05); color: var(--text-muted);">状态探测中...</span>
            </div>
            <div class="config-panel-body hidden" id="gcp-panel-body" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 20px; border-radius: 12px; margin-top: 12px;">
                <p style="font-size:12px; color:var(--text-muted); margin-bottom: 16px;">
                    <i class="fa-solid fa-triangle-exclamation" style="color:var(--accent-pink); margin-right: 4px;"></i> <b>架构老炮保姆指南：</b> 智能网盘转换工具在云端大模型分析时，支持即时动态插拔、100% 区域对齐自愈、并自适应重构部署 BigQuery 外部表 DDL。配置保存后自动生效，无需重启后台！
                </p>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                    <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:12px; font-weight:600; color: var(--text-muted);">GCP 项目 ID (Project ID)</label>
                        <input type="text" id="gcp-input-project" style="background:#0f1124; border:1px solid var(--border-color); color:#fff; padding:10px; border-radius:8px; font-size:12px;" placeholder="例如: webeye-internal-test">
                    </div>
                    <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:12px; font-weight:600; color: var(--text-muted);">GCS 智能网盘主存储桶 (Bucket Name)</label>
                        <input type="text" id="gcp-input-bucket" style="background:#0f1124; border:1px solid var(--border-color); color:#fff; padding:10px; border-radius:8px; font-size:12px;" placeholder="例如: bqca-demo">
                    </div>
                    <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:12px; font-weight:600; color: var(--text-muted);">BQ 物理外部连接 (Connection Name)</label>
                        <input type="text" id="gcp-input-connection" style="background:#0f1124; border:1px solid var(--border-color); color:#fff; padding:10px; border-radius:8px; font-size:12px;" placeholder="例如: bqca_external_connection">
                    </div>
                </div>

                <!-- 云端探针自检返回区 -->
                <div class="gcp-verify-card hidden" id="gcp-verify-result-box" style="margin-bottom:16px; padding:16px; border-radius:8px; font-size:12px;">
                    <!-- 这里会动态注入报错或成功的保姆指引 HTML -->
                </div>

                <div style="display:flex; justify-content:flex-end; gap:12px;">
                    <button class="primary-btn sparkle-btn" id="gcp-btn-save-verify" style="padding:10px 20px;">
                        <i class="fa-solid fa-circle-nodes"></i> 保存并一键云端物理自检
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // 插入到 header 下方
    header.insertAdjacentHTML("afterend", panelHtml);

    // 注入自定义分类 Modal
    const templateModalHtml = `
        <div class="modal-overlay hidden" id="template-modal">
            <div class="modal-card" style="max-width: 500px;">
                <div class="modal-header">
                    <h3><i class="fa-solid fa-plus"></i> 新增自定义分类模板</h3>
                    <button class="close-btn" id="template-modal-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="modal-body">
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label>分类 Key (英文小写，唯一标识)</label>
                        <input type="text" id="input-tpl-key" placeholder="例如: patent" style="background:#0f1124; border:1px solid var(--border-color); color:#fff; padding:12px; border-radius:8px; width:100%;">
                    </div>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label>分类名称 (中文名称)</label>
                        <input type="text" id="input-tpl-name" placeholder="例如: 专利技术专家" style="background:#0f1124; border:1px solid var(--border-color); color:#fff; padding:12px; border-radius:8px; width:100%;">
                    </div>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label>专属结构化 JSON 提示词模版 (Prompt Template)</label>
                        <textarea id="input-tpl-prompt" rows="6" placeholder="请在这里编写你的专属大模型 JSON 提取提示词，必须指定输出标准的纯 JSON 格式..." style="background:#0f1124; border:1px solid var(--border-color); color:#fff; padding:12px; border-radius:8px; width:100%; font-family:monospace; font-size:12px;"></textarea>
                    </div>
                </div>
                <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:12px;">
                    <button class="sec-btn" id="btn-cancel-tpl">取消</button>
                    <button class="sparkle-btn" id="btn-save-tpl" style="padding:10px 20px;">确认添加并保存</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", templateModalHtml);

    // 绑定展开收起逻辑 (模块A)
    document.getElementById("config-panel-toggle").addEventListener("click", () => {
        const body = document.getElementById("config-panel-body");
        const chevron = document.getElementById("config-chevron");
        body.classList.toggle("hidden");
        chevron.classList.toggle("fa-chevron-down");
        chevron.classList.toggle("fa-chevron-up");
    });

    // 绑定展开收起逻辑 (模块B)
    document.getElementById("gcp-panel-toggle").addEventListener("click", () => {
        const body = document.getElementById("gcp-panel-body");
        const chevron = document.getElementById("gcp-chevron");
        body.classList.toggle("hidden");
        chevron.classList.toggle("fa-chevron-down");
        chevron.classList.toggle("fa-chevron-up");
    });

    // -------------------------------------------------------------------------
    // 📡 GCP 连接配置控制台 运行时加载与交互绑定
    // -------------------------------------------------------------------------
    async function loadGCPConfig() {
        try {
            const res = await fetch(`${API_BASE}/api/config/`);
            const result = await res.json();
            if (result.success && result.data) {
                document.getElementById("gcp-input-project").value = result.data.gcp_project_id || "";
                document.getElementById("gcp-input-bucket").value = result.data.gcs_bucket_name || "";
                document.getElementById("gcp-input-connection").value = result.data.bq_connection_name || "";
                
                // 状态灯更新
                const pill = document.getElementById("gcp-probe-status-pill");
                if (pill) {
                    pill.textContent = `已绑定 [${result.data.gcs_bucket_name}]`;
                    pill.style.background = "rgba(46, 204, 113, 0.15)";
                    pill.style.color = "#2ecc71";
                    pill.style.border = "1px solid rgba(46, 204, 113, 0.2)";
                }
            }
        } catch (e) {
            console.error("加载GCP中控参数异常", e);
        }
    }
    loadGCPConfig();

    // 绑定“保存并执行自检”
    const btnGcpSaveVerify = document.getElementById("gcp-btn-save-verify");
    if (btnGcpSaveVerify) {
        btnGcpSaveVerify.addEventListener("click", async () => {
            const projectId = document.getElementById("gcp-input-project").value.trim();
            const bucketName = document.getElementById("gcp-input-bucket").value.trim();
            const connectionName = document.getElementById("gcp-input-connection").value.trim();

            if (!projectId || !bucketName || !connectionName) {
                showToast("配置不可为空", "听哥劝，GCP三要素（项目ID、桶名、连接名）可不能留空！", "error");
                return;
            }

            btnGcpSaveVerify.disabled = true;
            btnGcpSaveVerify.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> 正在对齐区域并连通物理探针自检中...`;

            const resultBox = document.getElementById("gcp-verify-result-box");
            resultBox.classList.add("hidden");

            try {
                // 2.1：保存配置入库 SQLite
                const saveRes = await fetch(`${API_BASE}/api/config/save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        gcp_project_id: projectId,
                        gcs_bucket_name: bucketName,
                        bq_connection_name: connectionName
                    })
                });
                const saveJson = await saveRes.json();
                if (!saveJson.success) {
                    showToast("保存配置失败", saveJson.message, "error");
                    btnGcpSaveVerify.disabled = false;
                    btnGcpSaveVerify.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> 保存并一键云端物理自检`;
                    return;
                }

                // 2.2：调用物理自检探针 API
                const verifyRes = await fetch(`${API_BASE}/api/config/verify`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        gcp_project_id: projectId,
                        gcs_bucket_name: bucketName,
                        bq_connection_name: connectionName
                    })
                });
                const verifyJson = await verifyRes.json();

                resultBox.classList.remove("hidden");
                const pill = document.getElementById("gcp-probe-status-pill");

                if (verifyJson.success) {
                    // 自检成功喜报
                    resultBox.style.border = "1px solid #2ecc71";
                    resultBox.style.background = "rgba(46, 204, 113, 0.05)";
                    resultBox.innerHTML = `
                        <div style="display:flex; align-items:center; gap:10px; color:#2ecc71; font-weight:700; margin-bottom:8px; font-size:13px;">
                            <i class="fa-solid fa-circle-check" style="font-size:16px;"></i> 📡 云端物理链路 100% 自检闭环通关！
                        </div>
                        <p style="color:var(--text-muted); line-height:1.6; margin:0; font-size:12px;">
                            🛰️ <b>区域自动对齐自愈成功：</b> 探测到您的云端主存储桶位于物理区域 <b style="color:#2ecc71;">${verifyJson.report.gcs_location}</b>，智提引擎已自动完成数仓数据集、外部表路径物理对齐。<br>
                            🔑 <b>BigQuery Connection 服务账号 (Service Account)：</b><br>
                            <code id="verify-sa-email" style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-family:monospace; color:#fff; display:inline-block; margin-top:4px; font-size:11px;">${verifyJson.report.service_account}</code> 
                            <button class="sec-btn" id="btn-copy-sa" style="padding:2px 8px; font-size:10px; margin-left:6px; cursor:pointer; vertical-align:middle;">[📋 一键复制]</button>
                        </p>
                    `;
                    
                    // 绑定服务账号一键复制
                    document.getElementById("btn-copy-sa").onclick = () => {
                        navigator.clipboard.writeText(verifyJson.report.service_account);
                        showToast("复制成功", "服务账号已复制到剪切板，去 GCP 存储桶授权即可！", "success");
                    };

                    if (pill) {
                        pill.textContent = `已连接 [${bucketName}]`;
                        pill.style.background = "rgba(46, 204, 113, 0.15)";
                        pill.style.color = "#2ecc71";
                        pill.style.border = "1px solid rgba(46, 204, 113, 0.2)";
                    }
                    showToast("自检成功", "您的云端大平层连接已全物理闭环打通！", "success");
                } else {
                    // 自检失败排查
                    resultBox.style.border = "1px solid var(--accent-pink)";
                    resultBox.style.background = "rgba(231, 76, 60, 0.05)";
                    
                    const guideText = (verifyJson.report && verifyJson.report.guide) ? verifyJson.report.guide.replace(/\n/g, "<br>") : "未获取到引导指引。";
                    const errMsg = (verifyJson.report && verifyJson.report.error_message) ? verifyJson.report.error_message : "未知网络或初始化错误。";
                    const errorStep = (verifyJson.report && verifyJson.report.error_step) ? verifyJson.report.error_step : "INITIAL_CHECK";

                    resultBox.innerHTML = `
                        <div style="display:flex; align-items:center; gap:10px; color:#e74c3c; font-weight:700; margin-bottom:8px; font-size:13px;">
                            <i class="fa-solid fa-circle-xmark" style="font-size:16px;"></i> ❌ 云端自检卡关 (诊断诊断: ${errorStep})
                        </div>
                        <p style="color:#fff; margin-bottom:8px; line-height:1.6; margin-top:0; font-size:12px;">
                            <b>底层故障抛错：</b><span style="color:var(--accent-pink); font-family:monospace; background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:4px; font-size:11px; display:inline-block; margin-top:4px;">${errMsg}</span>
                        </p>
                        <div style="background:rgba(255,255,255,0.03); border: 1px dashed rgba(255,255,255,0.1); padding:12px; border-radius:6px; color:var(--text-muted); line-height:1.6; margin-top:8px; font-size:11px;">
                            💡 <b>老麦架构诊断保姆指南：</b><br>
                            ${guideText}
                        </div>
                    `;

                    if (pill) {
                        pill.textContent = "自检卡关";
                        pill.style.background = "rgba(231, 76, 60, 0.15)";
                        pill.style.color = "var(--accent-pink)";
                        pill.style.border = "1px solid rgba(231, 76, 60, 0.2)";
                    }
                    showToast("云端连通故障", "未通过探针自检，请根据提示诊断排查配置！", "error");
                }

            } catch (e) {
                console.error("一键验证接口联调异常", e);
                showToast("连接验证失败", "无法连通后台自检接口，请检查后端运行状态！", "error");
            } finally {
                btnGcpSaveVerify.disabled = false;
                btnGcpSaveVerify.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> 保存并一键云端物理自检`;
            }
        });
    }

    // 绑定滑块更新值显示
    const slider = document.getElementById("input-temp");
    const valTemp = document.getElementById("val-temp");
    slider.addEventListener("input", (e) => {
        valTemp.textContent = e.target.value;
        saveConfigToLocalStorage();
    });

    document.getElementById("input-tokens").addEventListener("change", saveConfigToLocalStorage);

    // 绑定分类 Modal 事件
    const templateModal = document.getElementById("template-modal");
    document.getElementById("template-modal-close").onclick = () => templateModal.classList.add("hidden");
    document.getElementById("btn-cancel-tpl").onclick = () => templateModal.classList.add("hidden");

    document.getElementById("btn-save-tpl").onclick = async () => {
        const key = document.getElementById("input-tpl-key").value.trim().toLowerCase();
        const name = document.getElementById("input-tpl-name").value.trim();
        const prompt = document.getElementById("input-tpl-prompt").value.trim();

        if (!key || !name || !prompt) {
            showToast("输入校验", "请完整填写分类 Key、名称和提示词！", "warning");
            return;
        }
        
        if (!/^[a-z_]+$/.test(key)) {
            showToast("Key 校验", "分类 Key 必须为纯英文小写（支持下划线），例如: patent", "warning");
            return;
        }

        const success = await saveTemplateToBackend(key, name, prompt);
        if (success) {
            showToast("添加分类成功", `已成功将自定义分类 <strong>${name}</strong> 注册并持久化落库！`, "success");
            templateModal.classList.add("hidden");
            document.getElementById("input-tpl-key").value = "";
            document.getElementById("input-tpl-name").value = "";
            document.getElementById("input-tpl-prompt").value = "";
            await fetchTemplates();
        } else {
            showToast("添加分类失败", "保存分类至后台数据库失败！", "error");
        }
    };
}

function loadLocalConfigFromCache() {
    let presets = localStorage.getItem("bqca_saas_presets");
    if (!presets) {
        presets = JSON.stringify({ temperature: 0.1, max_output_tokens: 1024 });
        localStorage.setItem("bqca_saas_presets", presets);
    }
    const pObj = JSON.parse(presets);

    // 设置输入框值
    document.getElementById("input-temp").value = pObj.temperature || 0.1;
    document.getElementById("val-temp").textContent = pObj.temperature || 0.1;
    document.getElementById("input-tokens").value = pObj.max_output_tokens || 1024;
}

function saveConfigToLocalStorage() {
    const configObj = {
        temperature: parseFloat(document.getElementById("input-temp").value),
        max_output_tokens: parseInt(document.getElementById("input-tokens").value)
    };
    localStorage.setItem("bqca_saas_presets", JSON.stringify(configObj));
}

function switchPromptTab(tabName) {
    currentActiveCategory = tabName; // 全局追踪当前活跃模板分类，实现完美的手自一体靶向分析
    const btns = document.querySelectorAll("#tab-triggers button");
    const contents = document.querySelectorAll("#tab-contents > div");
    
    btns.forEach(btn => btn.classList.remove("active"));
    contents.forEach(div => div.classList.add("hidden"));

    const targetBtn = document.getElementById(`tab-btn-${tabName}`);
    const targetContent = document.getElementById(`tab-content-${tabName}`);
    
    if (targetBtn) targetBtn.classList.add("active");
    if (targetContent) targetContent.classList.remove("hidden");
}

// -------------------------------------------------------------------------
// 5. 初始化与新建网盘空间 Workflow (Workspace)
// -------------------------------------------------------------------------
async function initializeDefaultWorkspace() {
    try {
        const res = await fetch(`${API_BASE}/api/workspace/list`);
        const result = await res.json();
        
        workspaceList.innerHTML = ""; // 清空静态侧边栏
        
        if (result.success && result.data.length > 0) {
            // 渲染所有已存在的空间
            result.data.forEach((ws, idx) => {
                addWorkspaceItemToSidebar(ws.workspace_id, ws.workspace_name, idx === 0);
            });
            // 默认选择第一个
            const first = result.data[0];
            selectWorkspace(first.workspace_id, first.workspace_name);
            showToast("智能数仓发现", `已从 Google BigQuery 自动拉取并对齐 ${result.data.length} 个已有空间！`, "info", 3500);
        } else {
            // 回退到静态默认演示空间
            const defaultSpace = { workspace_id: "saas_audit_demo", workspace_name: "2026法务与财务智能核对空间" };
            addWorkspaceItemToSidebar(defaultSpace.workspace_id, defaultSpace.workspace_name, true);
            selectWorkspace(defaultSpace.workspace_id, defaultSpace.workspace_name);
        }
    } catch (e) {
        console.error("无法加载云端数仓空间列表，降级加载演示空间", e);
        const defaultSpace = { workspace_id: "saas_audit_demo", workspace_name: "2026法务与财务智能核对空间" };
        addWorkspaceItemToSidebar(defaultSpace.workspace_id, defaultSpace.workspace_name, true);
        selectWorkspace(defaultSpace.workspace_id, defaultSpace.workspace_name);
    }
}

function addWorkspaceItemToSidebar(id, name, isActive = false) {
    const li = document.createElement("li");
    li.className = `workspace-item ${isActive ? 'active' : ''}`;
    li.innerHTML = `<i class="fa-solid fa-folder-closed"></i> <span>${name}</span>`;
    li.onclick = () => selectWorkspace(id, name);
    workspaceList.appendChild(li);
}

function selectWorkspace(id, name) {
    currentWorkspace = id;
    
    // 切换 Sidebar 高亮
    document.querySelectorAll(".workspace-item").forEach(item => {
        if (item.querySelector("span").textContent === name) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    currentSpaceTitle.textContent = name;
    currentSpaceDesc.textContent = `空间 ID: ${id} | 已打通专属 GCS 目录并连接隔离 BigQuery 数仓`;

    // 启用上传区域
    dropzone.classList.remove("disabled");
    btnTriggerAnalyze.disabled = false;

    // 拉取该空间下的上传文件和分析结果
    fetchFileList();
    fetchAnalysisResults();
}

// -------------------------------------------------------------------------
// 6. 新建网盘空间 Modal 交互
// -------------------------------------------------------------------------
btnNewSpace.onclick = () => spaceModal.classList.remove("hidden");
modalClose.onclick = () => spaceModal.classList.add("hidden");
btnCancelCreate.onclick = () => spaceModal.classList.add("hidden");

btnConfirmCreate.onclick = async () => {
    const id = inputSpaceId.value.trim();
    const name = inputSpaceName.value.trim();

    if (!id || !name) {
        showToast("输入校验", "请完整填写空间 ID 与名称！", "warning");
        return;
    }

    btnConfirmCreate.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在全自动创建云端数仓...`;
    btnConfirmCreate.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/api/workspace/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspace_id: id, workspace_name: name })
        });
        const result = await response.json();

        if (result.success) {
            addWorkspaceItemToSidebar(id, name, false);
            spaceModal.classList.add("hidden");
            selectWorkspace(id, name);
            showToast("一键开通成功", "已自动完成 GCS、BigQuery 的零配置对接部署。", "success");
        } else {
            showToast("创建异常", result.message, "error");
        }
    } catch (e) {
        showToast("连接失败", "无法连接本地 Python API 接口，请确保后端 FastAPI 服务已正常启动！", "error");
    } finally {
        btnConfirmCreate.innerHTML = "一键全自动初始化";
        btnConfirmCreate.disabled = false;
        inputSpaceId.value = "";
        inputSpaceName.value = "";
    }
};

// -------------------------------------------------------------------------
// 7. GCS Signed URL 网盘拖拽上传 Workflow
// -------------------------------------------------------------------------
dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!dropzone.classList.contains("disabled")) {
        dropzone.style.borderColor = "var(--primary-color)";
    }
});

dropzone.addEventListener("dragleave", () => {
    dropzone.style.borderColor = "rgba(255, 255, 255, 0.1)";
});

dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "rgba(255, 255, 255, 0.1)";

    if (dropzone.classList.contains("disabled") || !currentWorkspace) return;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    for (let file of files) {
        await uploadFileToGCS(file);
    }
});

async function uploadFileToGCS(file) {
    const originalText = document.querySelector(".upload-text").textContent;
    document.querySelector(".upload-text").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在为 ${file.name} 申请 Signed URL 临时凭证...`;

    try {
        // 1. 申请 GCS 临时上传签名 URL
        const res = await fetch(`${API_BASE}/api/files/signed-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                workspace_id: currentWorkspace,
                filename: file.name,
                content_type: file.type || "application/octet-stream"
            })
        });
        const result = await res.json();

        if (!result.success) {
            showToast("凭证申请失败", result.message, "error");
            return;
        }

        const { upload_url, gcs_uri } = result.data;

        // 2. 使用 PUT 请求直传二进制流到谷歌 GCS (100% 绕过 Python 服务器，极速、零带宽开销)
        document.querySelector(".upload-text").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在安全上传二进制流至 GCS 桶中 (0%)...`;
        
        const uploadRes = await axiosPutWithProgress(upload_url, file);

        if (uploadRes.status === 200) {
            showToast("GCS 直传成功", `文件 <strong>${file.name}</strong> 已经安全落入 GCS 专有目录并同步至 BQ 对象表！`, "success");
            fetchFileList();
        } else {
            showToast("GCS 上传失败", `HTTP 状态码: ${uploadRes.status}`, "error");
        }

    } catch (e) {
        showToast("上传网络异常", e.message, "error");
    } finally {
        document.querySelector(".upload-text").textContent = originalText;
    }
}

// 纯 JS 实现的 AJAX 带进度条上传
function axiosPutWithProgress(url, file) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                document.querySelector(".upload-text").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在安全上传二进制流至 GCS 桶中 (${percent}%)...`;
            }
        };

        xhr.onload = () => resolve({ status: xhr.status });
        xhr.onerror = () => reject(new Error("网络上传中断"));
        xhr.send(file);
    });
}

async function fetchFileList() {
    if (!currentWorkspace) return;
    try {
        const res = await fetch(`${API_BASE}/api/files/list/${currentWorkspace}?_t=${Date.now()}`);
        const result = await res.json();
        netdiskFileList.innerHTML = "";

        if (result.success && result.data.length > 0) {
            result.data.forEach(f => {
                const li = document.createElement("li");
                li.className = "file-item";
                li.style.display = "flex";
                li.style.justifyContent = "space-between";
                li.style.alignItems = "center";
                li.style.padding = "12px 16px";
                li.style.borderBottom = "1px solid var(--border-color)";
                li.style.transition = "all 0.2s ease";

                li.title = `【原始中文名】\n${f.filename}\n\n【云端物理名】\n${f.physical_name}`;
                li.style.cursor = "pointer";

                const sizeKB = (f.size_bytes / 1024).toFixed(1);
                li.innerHTML = `
                    <div class="file-meta" style="display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; align-items: flex-start; max-width: calc(100% - 70px);">
                        <!-- 第一行：中文友好名称 -->
                        <div style="display: flex; align-items: center; gap: 8px; width: 100%; overflow: hidden;">
                            <i class="fa-regular fa-file-lines" style="color: var(--primary-color); font-size: 15px; flex-shrink: 0;"></i>
                            <span style="font-weight: 600; color: #fff; font-size: 13px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; flex: 1;" title="${f.filename}">${f.filename}</span>
                        </div>
                        <!-- 第二行：GCS云端真实物理名称（100%可见，自动折行，绝不溢出） -->
                        <div style="display: flex; align-items: flex-start; gap: 6px; font-size: 10.5px; color: var(--text-muted); font-family: monospace; padding-left: 24px; width: 100%; line-height: 1.4; overflow: hidden;">
                            <i class="fa-solid fa-cloud" style="font-size: 9px; color: var(--accent-pink); flex-shrink: 0; margin-top: 3px;"></i>
                            <span style="flex: 1; color: rgba(255, 255, 255, 0.45); cursor: text; white-space: normal !important; word-break: break-all !important; display: inline-block; max-width: 100%;" title="此文件在 GCS 桶中的实际物理名">物理名: ${f.physical_name}</span>
                        </div>
                    </div>
                    <!-- 右侧：文件大小（顶部对齐防止拉伸变形） -->
                    <span class="file-size" style="font-size: 12px; color: var(--text-muted); font-weight: 500; min-width: 60px; text-align: right; flex-shrink: 0; align-self: flex-start; margin-top: 2px;">${sizeKB} KB</span>
                `;
                netdiskFileList.appendChild(li);
            });
        } else {
            netdiskFileList.innerHTML = `<li class="empty-list-hint">空间内暂无上传文件</li>`;
        }
    } catch (e) {
        console.error(e);
    }
}

// -------------------------------------------------------------------------
// 8. 触发大模型一键分析与结果轮询 Workflow
// -------------------------------------------------------------------------
btnTriggerAnalyze.onclick = async () => {
    if (!currentWorkspace) return;

    const modeText = currentActiveCategory === "auto" ? "智能分流" : "靶向直通";
    btnTriggerAnalyze.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在进行 [${modeText}] 提取中...`;
    btnTriggerAnalyze.disabled = true;
    isAnalyzing = true;

    const presets = JSON.parse(localStorage.getItem("bqca_saas_presets") || "{}");
    const pContract = document.getElementById("prompt-area-contract")?.value || null;
    const pResume = document.getElementById("prompt-area-resume")?.value || null;
    const pInvoice = document.getElementById("prompt-area-invoice")?.value || null;
    const pOther = document.getElementById("prompt-area-other")?.value || null;

    try {
        const res = await fetch(`${API_BASE}/api/workspace/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                workspace_id: currentWorkspace,
                category: currentActiveCategory, // 将当前处于高亮选中查看的模板类别参数注入
                temperature: presets.temperature || 0.1,
                max_output_tokens: presets.max_output_tokens || 1024,
                prompt_contract: pContract,
                prompt_resume: pResume,
                prompt_invoice: pInvoice,
                prompt_other: pOther
            })
        });
        const result = await res.json();

        if (result.success) {
            // 开始前端轮询
            pollAnalysisResults();
            showToast("分析引擎已激活", `已成功拉起 [${modeText}] 提取流水线，AI 正在分析，请稍候...`, "info", 4000);
        } else {
            showToast("触发分析失败", result.message, "error");
            btnTriggerAnalyze.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> 一键大模型提取 & 绑定 BQCA`;
            btnTriggerAnalyze.disabled = false;
            isAnalyzing = false;
        }
    } catch (e) {
        showToast("网络请求异常", "触发一键分析失败，请检查网络！", "error");
        btnTriggerAnalyze.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> 一键大模型提取 & 绑定 BQCA`;
        btnTriggerAnalyze.disabled = false;
        isAnalyzing = false;
    }
}

function pollAnalysisResults() {
    let attempts = 0;
    const interval = setInterval(async () => {
        attempts++;
        if (attempts > 12) { // 最多轮询 1 分钟
            clearInterval(interval);
            showToast("编译时间较长", "提取视图热重构编译较慢，系统将在后台继续，请稍后手动刷新列表。", "warning", 6000);
            resetAnalyzeButtonState();
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/api/workspace/results/${currentWorkspace}`);
            const result = await res.json();

            if (result.success && result.data.length > 0) {
                clearInterval(interval);
                analysisResults = result.data;
                renderAnalysisTable();
                resetAnalyzeButtonState();
                showToast("提取 & 编译完成", "两阶段自适应大模型分析已完成，拆列提取结果已完美呈现且在 BigQuery 就绪！", "success", 5000);
            }
        } catch (e) {
            console.error(e);
        }
    }, 5000);
}

function resetAnalyzeButtonState() {
    btnTriggerAnalyze.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> 一键大模型提取 & 绑定 BQCA`;
    btnTriggerAnalyze.disabled = false;
    isAnalyzing = false;
}

async function fetchAnalysisResults() {
    if (!currentWorkspace || isAnalyzing) return;
    try {
        const res = await fetch(`${API_BASE}/api/workspace/results/${currentWorkspace}`);
        const result = await res.json();
        if (result.success && result.data.length > 0) {
            analysisResults = result.data;
            renderAnalysisTable();
        } else {
            analysisTableBody.innerHTML = `<tr><td colspan="6" class="table-empty-hint">请上传文件并点击“一键大模型提取”按钮开始分析</td></tr>`;
        }
    } catch (e) {
        console.error(e);
    }
}

function renderAnalysisTable() {
    analysisTableBody.innerHTML = "";
    analysisResults.forEach((row, index) => {
        const tr = document.createElement("tr");
        
        // 格式化金额展示
        const moneyDisplay = row.amount ? `${row.amount.toLocaleString()} ${row.currency}` : "—";
        
        // 解析状态 Pill
        const statusClass = row.parse_status === "approved" ? "status-approved" : "status-pending";
        const statusText = row.parse_status === "approved" ? "Approved 已核对" : "Pending 待人工核";
        const statusIcon = row.parse_status === "approved" ? "fa-circle-check" : "fa-circle-dot";

        // 置信度 Badge
        const confClass = `confidence-${row.confidence_score}`;

        tr.innerHTML = `
            <td><span class="badge badge-bq">${row.doc_type.toUpperCase()}</span></td>
            <td style="font-weight: 500; color: #fff;">${row.doc_title}</td>
            <td style="font-family: monospace; color: var(--accent-pink);">${moneyDisplay}</td>
            <td>
                <span class="status-pill ${statusClass}">
                    <i class="fa-solid ${statusIcon}"></i> ${statusText}
                </span>
            </td>
            <td><span class="confidence-badge ${confClass}">${row.confidence_score.toUpperCase()}</span></td>
            <td>
                <button class="primary-btn" style="padding: 6px 12px; font-size: 11px;" onclick="openHumanReview(${index})">
                    <i class="fa-solid fa-user-shield"></i> 核对并通过
                </button>
            </td>
        `;
        analysisTableBody.appendChild(tr);
    });
}

// -------------------------------------------------------------------------
// 9. 双屏纠错与人工确认 HIL Workflow (Human-in-the-Loop)
// -------------------------------------------------------------------------
let currentReviewIndex = null;

window.openHumanReview = function(index) {
    currentReviewIndex = index;
    const data = analysisResults[index];

    // 1. 动态填充 HIL 纠错表单
    document.getElementById("hil-uri").value = data.uri;
    document.getElementById("hil-doc-type").value = data.doc_type;
    document.getElementById("hil-title").value = data.doc_title;
    document.getElementById("hil-parties").value = data.parties.join(", ");
    document.getElementById("hil-amount").value = data.amount || "";
    document.getElementById("hil-currency").value = data.currency || "CNY";
    document.getElementById("hil-summary").value = data.summary;
    document.getElementById("hil-dynamics").value = JSON.stringify(data.dynamic_attributes, null, 2);

    // 2. 动态注入左侧证据链原文 (Evidence Quotes) - 【智能自适应双保险解析器】
    evidenceContainer.innerHTML = "";
    let evidenceObj = {};
    if (data.evidence) {
        if (typeof data.evidence === "string") {
            try {
                evidenceObj = JSON.parse(data.evidence);
            } catch (e) {
                evidenceObj = { "原文引用": data.evidence };
            }
        } else if (typeof data.evidence === "object") {
            evidenceObj = data.evidence;
        }
    }

    if (evidenceObj && Object.keys(evidenceObj).length > 0) {
        for (let key in evidenceObj) {
            const block = document.createElement("div");
            block.className = "evidence-item";
            block.innerHTML = `
                <div class="evidence-field"><i class="fa-solid fa-quote-left"></i> ${key} 提取依据</div>
                <div class="evidence-quote">“${evidenceObj[key]}”</div>
            `;
            evidenceContainer.appendChild(block);
        }
    } else {
        evidenceContainer.innerHTML = `<div class="empty-list-hint">大模型该分类未输出具体引用证据。</div>`;
    }

    // 3. 打开侧边审核板
    reviewSheet.classList.remove("hidden");
};

sheetClose.onclick = closeReviewSheet;
btnHilCancel.onclick = closeReviewSheet;

function closeReviewSheet() {
    reviewSheet.classList.add("hidden");
    currentReviewIndex = null;
}

btnHilSubmit.onclick = async () => {
    if (currentReviewIndex === null) return;

    btnHilSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在建表并绑定 BQCA...`;
    btnHilSubmit.disabled = true;

    const payload = {
        uri: document.getElementById("hil-uri").value,
        doc_type: document.getElementById("hil-doc-type").value,
        doc_title: document.getElementById("hil-title").value.trim(),
        parties: document.getElementById("hil-parties").value.split(",").map(p => p.trim()).filter(Boolean),
        amount: parseFloat(document.getElementById("hil-amount").value) || null,
        currency: document.getElementById("hil-currency").value.trim().toUpperCase(),
        summary: document.getElementById("hil-summary").value.trim(),
        dynamic_attributes: JSON.parse(document.getElementById("hil-dynamics").value)
    };

    try {
        const res = await fetch(`${API_BASE}/api/workspace/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                workspace_id: currentWorkspace,
                payload: payload
            })
        });
        const result = await res.json();

        if (result.success) {
            showToast("人工核对完成", "系统已在 BigQuery 部署带语义描述的物理结果表，并秒级绑定 BQCA！", "success", 5000);
            
            // 更新本地数据并重绘表格
            analysisResults[currentReviewIndex].doc_title = payload.doc_title;
            analysisResults[currentReviewIndex].parties = payload.parties;
            analysisResults[currentReviewIndex].amount = payload.amount;
            analysisResults[currentReviewIndex].currency = payload.currency;
            analysisResults[currentReviewIndex].summary = payload.summary;
            analysisResults[currentReviewIndex].dynamic_attributes = payload.dynamic_attributes;
            analysisResults[currentReviewIndex].parse_status = "approved";
            
            renderAnalysisTable();
            closeReviewSheet();

            // 智能联动：一键激活并弹出 BQCA 对话挂件！
            activateBQCAChatWidget();
        } else {
            showToast("绑定物理表失败", result.message, "error");
        }
    } catch (e) {
        showToast("物理归档异常", "核对提交异常，无法写入物理结果表，请检查网络！", "error");
    } finally {
        btnHilSubmit.innerHTML = `<i class="fa-solid fa-circle-check"></i> 确认无误，精准归档落库`;
        btnHilSubmit.disabled = false;
    }
};

// -------------------------------------------------------------------------
// 10. BQCA 智脑悬浮对话 Workflow (BI Natural Language Q&A Panel)
// -------------------------------------------------------------------------
function activateBQCAChatWidget() {
    bqcaWidget.classList.remove("hidden");
    // 自动弹起聊天面板
    bqcaChatBox.classList.remove("hidden");
    bqcaToggle.classList.add("hidden");
}

bqcaToggle.onclick = () => {
    bqcaChatBox.classList.remove("hidden");
    bqcaToggle.classList.add("hidden");
};

chatCloseBtn.onclick = () => {
    bqcaChatBox.classList.add("hidden");
    bqcaToggle.classList.remove("hidden");
};

btnSendChat.onclick = handleSendChatMessage;
bqcaInput.onkeydown = (e) => {
    if (e.key === "Enter") handleSendChatMessage();
};

function handleSendChatMessage() {
    const text = bqcaInput.value.trim();
    if (!text) return;

    // 插入用户气泡
    appendMessage(text, "msg-user");
    bqcaInput.value = "";

    // 智能解析提问，给出超有逼格的 SQL 模拟分析应答
    setTimeout(() => {
        const botResponse = generateMockBQCAGeminiResponse(text);
        appendMessage(botResponse, "msg-bot");
    }, 1200);
}

function appendMessage(text, className) {
    const div = document.createElement("div");
    div.className = `msg ${className}`;
    div.innerHTML = `<p>${text}</p>`;
    bqcaMessages.appendChild(div);
    bqcaMessages.scrollTop = bqcaMessages.scrollHeight;
}

// 模拟 BQCA 中 Gemini 读取带 OPTIONS descriptions 列描述注释后的“NL-to-SQL”神准应答
function generateMockBQCAGeminiResponse(query) {
    const hasAuditWord = query.includes("合同") || query.includes("钱") || query.includes("万") || query.includes("金额");
    const hasResumeWord = query.includes("简历") || query.includes("工作") || query.includes("年") || query.includes("经验") || query.includes("开发");

    let sqlStr = "";
    let ansStr = "";

    if (hasAuditWord) {
        sqlStr = `SELECT doc_title, amount, currency FROM \`workspace_${currentWorkspace}.t_verified_smart_drive\` WHERE amount > 50000;`;
        ansStr = `🔍 <b>Gemini 翻译 SQL 解析成功！</b><br>
        我读取了列级 <code>OPTIONS(description)</code>，确定金额字段为 <code>amount</code>，已被人工核对无误。后台自动穿透执行：<br>
        <pre style="background:#000; padding:6px; font-size:11px; color:#10b981; border-radius:4px; margin:6px 0;">${sqlStr}</pre>
        发现当前已核对通过的合同中有 <b>1 份金额大于 50,000 元</b>。合同名称为《框架采购服务协议》，核算金额为 100,000.00 CNY。`;
    } else if (hasResumeWord) {
        sqlStr = `SELECT doc_title, JSON_VALUE(dynamic_attributes, '$.experience_years') AS exp FROM \`workspace_${currentWorkspace}.t_verified_smart_drive\` WHERE doc_type = 'resume' AND CAST(JSON_VALUE(dynamic_attributes, '$.experience_years') AS INT64) >= 5;`;
        ansStr = `🔍 <b>Gemini 翻译 SQL 解析成功！</b><br>
        我读取了 <code>dynamic_attributes</code> 上的语义注释：【包含求职技术栈和工作年限】。后台自动穿透 JSON 运行：<br>
        <pre style="background:#000; padding:6px; font-size:11px; color:#10b981; border-radius:4px; margin:6px 0;">${sqlStr}</pre>
        为您找到 <b>1 份</b> 具有 5 年以上开发经验的简历：<br>
        - 候选人姓名：张三，工作年限：5 年，核心技术：Java, Spring Boot, BigQuery。`;
    } else {
        sqlStr = `SELECT doc_title, summary FROM \`workspace_${currentWorkspace}.t_verified_smart_drive\` WHERE parse_status = 'approved';`;
        ansStr = `🔍 <b>Gemini 通用语义提取成功！</b><br>
        我读取了元数据注释列描述，自动在已核实通过的数据上执行汇总：<br>
        <pre style="background:#000; padding:6px; font-size:11px; color:#10b981; border-radius:4px; margin:6px 0;">${sqlStr}</pre>
        当前空间下已有 1 份文件通过人工核验并物理落库，文件类型为 <b>CONTRACT (合同)</b>，核心摘要为：“该合同是关于向供应商采购云服务器资源的框架协议，采购方承担主要履约责任，质保期为3年。”`;
    }

    return ansStr;
}
