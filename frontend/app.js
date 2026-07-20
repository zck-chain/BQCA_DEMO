/* =========================================================================
   💎 无界 AI 智能网盘转换工具 —— 前端核心业务逻辑
   Features: Signed URL 直传、大模型参数本地缓存与热配置、双屏核对、一键建表与 BQCA 激活
   ========================================================================= */

const API_BASE = window.location.origin.startsWith("http") ? window.location.origin : "http://127.0.0.1:8000";

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
  "key_dates": {
    "签署日期": "YYYY-MM-DD", 
    "截止日期": "YYYY-MM-DD"
  },
  "amount": 100000.00,
  "currency": "CNY",
  "summary": "合同核心采购标的和履约责任摘要（100字内）",
  "dynamic_attributes": {
    "buyer": "合同甲方(采购方)单位全称",
    "seller": "合同乙方(供货方)单位全称",
    "delivery_deadline": "最晚交货期限",
    "warranty_years": "质保年限"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "确定合同标题的原文段落",
    "parties": "确定签署双方(甲乙方)全称的原文条款原句",
    "key_dates": "确定合同签署日期与截止日期的原文条款原句",
    "amount": "确定合同总金额的原文条款原句",
    "currency": "确定计价货币的原文条款原句",
    "summary": "确定核心标的、履约责任对应的原文条款原句",
    "buyer": "确定甲方采购方名称的原文条款原句",
    "seller": "确定乙方供货方名称的原文条款原句",
    "delivery_deadline": "确定最晚交货期限的原文条款原句",
    "warranty_years": "确定质保年限的原文条款原句"
  }
}

【判定来源法务审计要求】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的 buyers/sellers/delivery_deadline 等）提供在合同原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到合同章节条款（如：“根据第二条第1款：交货期限为...”），绝不可含糊编造。若无原文提及，请写“未在合同原文中提及”。`,
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

// -------------------------------------------------------------------------
// 2.6 全局高级暗黑磨砂 UI 确认弹窗 (Sleek Glassmorphic Confirm)
// -------------------------------------------------------------------------
function showConfirmDialog(title, message, onConfirm) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "99999";
    overlay.style.backdropFilter = "blur(10px)";
    overlay.style.webkitBackdropFilter = "blur(10px)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    overlay.innerHTML = `
        <div class="modal-card" style="max-width: 380px; background: #0b0c16; border: 1px solid rgba(255, 71, 87, 0.3); box-shadow: 0 15px 45px rgba(255, 71, 87, 0.15); border-radius: 12px; text-align: center; padding: 24px; transform: scale(1);">
            <div style="width: 52px; height: 54px; background: rgba(255, 71, 87, 0.1); color: #ff4757; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; font-size: 22px; box-shadow: 0 0 15px rgba(255, 71, 87, 0.2);">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #fff; font-weight: 700;">${title}</h3>
            <p style="margin: 0 0 24px 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; padding: 0 8px;">${message}</p>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button id="confirm-btn-cancel" class="sec-btn" style="padding: 8px 18px; font-size: 11.5px; border-radius: 6px; flex: 1; cursor:pointer;">取消</button>
                <button id="confirm-btn-ok" style="background: linear-gradient(135deg, #ff4757, #ff6b81); border: none; color: #fff; padding: 8px 18px; font-size: 11.5px; border-radius: 6px; cursor: pointer; font-weight: 700; flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; box-shadow: 0 4px 12px rgba(255, 71, 87, 0.3);">
                    <i class="fa-solid fa-circle-check"></i> 确认执行
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector("#confirm-btn-cancel");
    const okBtn = overlay.querySelector("#confirm-btn-ok");

    const dismiss = () => {
        overlay.remove();
    };

    cancelBtn.onclick = (e) => {
        e.preventDefault();
        dismiss();
    };

    okBtn.onclick = async (e) => {
        e.preventDefault();
        okBtn.disabled = true;
        okBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 处理中...`;
        try {
            await onConfirm();
        } catch (err) {
            console.error(err);
        } finally {
            dismiss();
        }
    };
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
const fileInput = document.getElementById("file-input");

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
const historyTableBody = document.getElementById("history-table-body");
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

    // 💡 官方精调原厂 Prompts 预设
    const DEFAULT_OFFICIAL_PROMPTS = {
        contract: `你是一位极其严谨的资深“采购与法务审计专家”。请仔细审阅这份合同。
你的任务是精确提取合同的核心条款，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "合同主标题",
  "parties": ["采购方(甲方)企业全称", "销售方(乙方)企业全称"],
  "key_dates": {
    "合同签署日期": "YYYY-MM-DD",
    "合同截止日期": "YYYY-MM-DD"
  },
  "amount": 100000.00,
  "currency": "CNY",
  "summary": "关于该采购合同的核心履约责任、采购标的物与交付要求的精简总结",
  "dynamic_attributes": {
    "交货期限": "最晚交货期限或工程完工节点约定",
    "质保期限": "售后质保与硬件保修期限约定",
    "付款方式": "合同款项分期结算与付款要求约定"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "合同文本中关于主标题判定的原文依据段落与条款原句",
    "parties": "合同文本中签署双方甲乙企业名称判定的原文依据条款原句",
    "key_dates": "合同签署与截止期限判定的原文依据条款原句",
    "amount": "确定合同交易总金额判定的原文依据条款原句",
    "currency": "确定计价币种判定的原文依据条款原句",
    "summary": "确定合同总结信息的原文判定依据",
    "交货期限": "确定交货期约定的原文条款段落依据",
    "质保期限": "确定质保期约定的原文条款段落依据",
    "付款方式": "确定付款方式约定的原文条款段落依据"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据第三条第1款：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。`,

        resume: `你是一位极其严谨的资深“猎头招聘与人才审计专家”。请仔细审阅这份候选人求职简历。
你的任务是精确提取人才的核心资历，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "候选人求职简历标准标题",
  "parties": ["候选人姓名", "最近任职公司或毕业院校名称"],
  "key_dates": {
    "最近任职开始时间": "YYYY-MM-DD",
    "最近任职结束时间": "YYYY-MM-DD"
  },
  "amount": null,
  "currency": "CNY",
  "summary": "对该候选人专业技术背景、项目亮点与岗位匹配度的客观评价总结",
  "dynamic_attributes": {
    "求职岗位": "候选人求职或最近一段履历的岗位名称",
    "核心技术栈": "候选人最擅长且具备深度实战经验的核心技术体系",
    "工作年限": "候选人从第一份工作起算的总工作资历时长"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "简历文本中关于候选人主标题判定的原文依据段落原句",
    "parties": "简历文本中确定姓名、就职单位判定的原文依据段落原句",
    "key_dates": "简历中最近任职起止期限判定的原文依据条款原句",
    "amount": "确定期望薪资或财务属性的原文依据段落（若无请写“无”）",
    "currency": "确定期望薪资币种判定的原文依据段落（若无请写“无”）",
    "summary": "确定总结信息的原文判定依据",
    "求职岗位": "确定期望岗位的原文段落依据",
    "核心技术栈": "确定擅长技术栈的原文段落依据",
    "工作年限": "确定工作年限判定的原文段落依据"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据简历第几段：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。`,

        invoice: `你是一位极其严谨的资深“出纳审计与财务税务合规专家”。请仔细审阅这份发票凭证。
你的任务是精确提取发票的核对条款，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "发票标准标题",
  "parties": ["销售方(开票单位)企业全称", "购买方(受票单位)企业全称"],
  "key_dates": {
    "开票日期": "YYYY-MM-DD"
  },
  "amount": 10000.00,
  "currency": "CNY",
  "summary": "发票所开具的主营服务、商品类别及税率明细简述",
  "dynamic_attributes": {
    "发票号码": "发票票面上唯一的识别开票代码",
    "发票税率": "财务税控核账的法定开票税率"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "发票票面上标题判定的原文依据",
    "parties": "销售方与购买方企业名称判定的原文票面依据原句",
    "key_dates": "发票开具日期判定的原文票面依据原句",
    "amount": "确定发票含税总金额判定的原文票面依据原句",
    "currency": "确定发票计价币种判定的原文票面依据原句",
    "summary": "确定发票服务明细内容的原文判定依据",
    "发票号码": "确定发票号码判定的原文票面依据原句",
    "发票税率": "确定开票税率判定的原文票面依据原句"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据发票右上方：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。`,

        other: `你是一位极其严谨的资深“商业综合文档审计专家”。请仔细审阅这份综合性文档。
你的任务是精确提取文档的核心商业情报，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "文档主标题",
  "parties": ["文档提及的核心主体或公司名称列表"],
  "key_dates": {
    "关键时间时点": "YYYY-MM-DD"
  },
  "amount": null,
  "currency": "CNY",
  "summary": "对该综合文档一句话中文核心内容总结",
  "dynamic_attributes": {
    "文档分类描述": "大模型判定该文档的物理公约数分类属性",
    "核心结论": "文档中提炼出的对企业决策最关键的结论"
  },
  "confidence_score": "high",
  "evidence": {
    "doc_title": "文档文本中确定标题的原文依据段落",
    "parties": "文档中关于提及主体判定的原文依据段落",
    "key_dates": "文档中关键时间判定的原文依据段落",
    "amount": "文档中涉及的合同/交易金额依据（若无请写“无”）",
    "currency": "文档中涉及的计价币种依据（若无请写“无”）",
    "summary": "摘要提炼得出的原文段落依据",
    "文档分类描述": "确定文档属性分类的原文依据",
    "核心结论": "确定核心结论的原文段落依据"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应章节条款段落（例如：“根据文档第几段：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。`
    };

    // 💡 官方精调物理大数仓 11 核心大统一主列 Schema 看板 (真正落实首长的大平盘大一统、防误导架构)
    const SCHEMA_GUIDANCE_MAP = {
        contract: {
            title: "📜 采购法务合同 ── 物理数仓 11 核心黄金主列大平层规范",
            color: "rgba(116, 185, 255, 0.04)",
            border: "rgba(116, 185, 255, 0.4)",
            accent: "#74b9ff",
            fields: [
                { name: "doc_title", desc: "合同主标题 (STRING)" },
                { name: "parties", desc: "签署双方/买卖主体 JSON 数组，如：['甲方', '乙方']" },
                { name: "key_dates", desc: "签署日期、截止日期 JSON 键值对" },
                { name: "amount", desc: "合同总金额，物理数值型 (FLOAT64)，数仓支持直接 SUM/AVG" },
                { name: "currency", desc: "币种简写（如 CNY, USD）" },
                { name: "summary", desc: "大模型总结的合同履约责任核心摘要" },
                { name: "dynamic_attributes", desc: "特定独有属性（如交期、质保年限），全自动合拢塞入 JSON 动态大口袋" },
                { name: "evidence", desc: "<b>【灵魂证据链】</b>包含上述各字段在合同原文中的一字不漏依据原文 JSON" },
                { name: "confidence_score", desc: "置信度评估（high / medium / low）" }
            ],
            tip: "💡 <b>法务场景业务导流提示：</b> 提取的合同 <code>amount</code> 会自动对齐在 BigQuery 物理表主数值列上。大模型会将 <code>delivery_deadline</code> (交期)、<code>warranty_years</code> (质保期) 自动合拢塞入 <code>dynamic_attributes</code> 动态大口袋中，不污染主列架构！"
        },
        resume: {
            title: "💼 猎头简历专家 ── 物理数仓 11 核心黄金主列大平层规范",
            color: "rgba(162, 155, 254, 0.04)",
            border: "rgba(162, 155, 254, 0.4)",
            accent: "#a29bfe",
            fields: [
                { name: "doc_title", desc: "简历标准名称，格式如：'姓名_求职简历' (STRING)" },
                { name: "parties", desc: "候选人名称、最近任职公司 JSON 数组" },
                { name: "key_dates", desc: "最近入职时间等关键时点 JSON" },
                { name: "amount", desc: "通常为 null 或是期望薪资浮点数 (FLOAT64)" },
                { name: "currency", desc: "币种简写（如 CNY）" },
                { name: "summary", desc: "大模型对该候选人的专业背景评价与亮点总结" },
                { name: "dynamic_attributes", desc: "求职岗位 <code>job_title</code>、核心技术栈 <code>skills</code>，合拢塞入 JSON 动态大口袋" },
                { name: "evidence", desc: "<b>【灵魂证据链】</b>候选人就职履历、学历、项目真实判定来源原文依据 JSON" },
                { name: "confidence_score", desc: "置信度评估（high / medium / low）" }
            ],
            tip: "💡 <b>招聘场景业务导流提示：</b> 猎头评估不设大额账目交易，因此 <code>amount</code> 物理列将默认为 <code>null</code>；而 <code>job_title</code>、<code>skills</code> 等特有信息则自动塞入 <code>dynamic_attributes</code> 动态列，保持底层物理单表极简！"
        },
        invoice: {
            title: "🧾 发票财务核对 ── 物理数仓 11 核心黄金主列大平层规范",
            color: "rgba(16, 185, 129, 0.04)",
            border: "rgba(16, 185, 129, 0.4)",
            accent: "#10b981",
            fields: [
                { name: "doc_title", desc: "发票名称及销售方企业 (STRING)" },
                { name: "parties", desc: "财务交易双方数组，如：['销售方', '购买方']" },
                { name: "key_dates", desc: "开票日期等关键时间 JSON" },
                { name: "amount", desc: "发票含税总金额，物理数值型 (FLOAT64)，核账对账的唯一真相" },
                { name: "currency", desc: "币种简写（如 CNY）" },
                { name: "summary", desc: "开票服务或所采购产品细目大模型精简摘要" },
                { name: "dynamic_attributes", desc: "特有属性（发票号码 <code>invoice_code</code>、税率 <code>tax_rate</code>），打包塞入动态大口袋" },
                { name: "evidence", desc: "<b>【灵魂证据链】</b>发票金额、税率、开票主体在发票 PDF 中的判定依据原文 JSON" },
                { name: "confidence_score", desc: "置信度评估（high / medium / low）" }
            ],
            tip: "💡 <b>发票场景业务导流提示：</b> 强烈建议大模型输出纯数字格式的 <code>amount</code> (例如 <code>5000.00</code>)。<code>invoice_code</code>、<code>tax_rate</code> 将自动并入 <code>dynamic_attributes</code> 中。<code>evidence</code> 必须精准映射发票上的财务明细！"
        },
        other: {
            title: "📂 通用综合文档 ── 物理数仓 11 核心黄金主列大平层规范",
            color: "rgba(245, 158, 11, 0.04)",
            border: "rgba(245, 158, 11, 0.4)",
            accent: "#f59e0b",
            fields: [
                { name: "doc_title", desc: "文档主标题 (STRING)" },
                { name: "parties", desc: "文档中提及的核心主体或公司数组" },
                { name: "key_dates", desc: "文档提及的关键时点 JSON" },
                { name: "amount", desc: "通常为 null 或者是提及的合同/交易金额" },
                { name: "currency", desc: "币种简写（如 CNY）" },
                { name: "summary", desc: "大模型总结的文档一句话中文核心内容摘要" },
                { name: "dynamic_attributes", desc: "异构多模态特定自适应提炼属性键值对" },
                { name: "evidence", desc: "<b>【灵魂证据链】</b>提取的标题、主体、摘要在文档原文中对应的依据段落 JSON" },
                { name: "confidence_score", desc: "置信度评估（high / medium / low）" }
            ],
            tip: "💡 <b>通用场景业务导流提示：</b> 这是大公约数兜底分类，将自动保留统一 11 物理黄金主列（包括 <code>evidence</code>），让 BQCA 智脑牢牢锁定单表，彻底消除多表跨表关联带来的性能和语义幻觉！"
        }
    };

    // 🚀 【极致洁癖纯净化】：完全遵照用户指令下线阶段一自动分类器卡片，100% 走纯靶向专家卡片提取
    const allTemplates = [...loadedTemplates];

    allTemplates.forEach((t, idx) => {
        const btn = document.createElement("button");
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
        // 💡 方案一：并网 Schema 规范智能提示区 (Schema Guidance Box)
        // =========================================================================
        const schemaGuide = SCHEMA_GUIDANCE_MAP[t.category];
        const guideDiv = document.createElement("div");
        
        if (schemaGuide) {
            guideDiv.className = "schema-guide-card";
            guideDiv.style.background = schemaGuide.color;
            guideDiv.style.border = `1px solid ${schemaGuide.border}`;
            guideDiv.style.borderRadius = "8px";
            guideDiv.style.padding = "14px";
            guideDiv.style.marginTop = "10px";
            guideDiv.style.marginBottom = "10px";
            
            let fieldsHtml = "";
            schemaGuide.fields.forEach(f => {
                fieldsHtml += `
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:11px;">
                        <span style="background: rgba(255,255,255,0.05); padding: 1px 6px; border-radius:4px; color: ${schemaGuide.accent}; font-family:monospace; font-weight:600;">${f.name}</span>
                        <span style="color: var(--text-muted);">${f.desc}</span>
                    </div>
                `;
            });

            guideDiv.innerHTML = `
                <div style="font-size:12px; font-weight:700; color: #fff; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                    <i class="fa-regular fa-lightbulb" style="color: ${schemaGuide.accent}; font-size:14px;"></i>
                    <span>${schemaGuide.title}</span>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:x-12px; margin-bottom:10px;">
                    ${fieldsHtml}
                </div>
                <div style="font-size:11px; color: var(--text-muted); border-top: 1px dashed rgba(255,255,255,0.06); padding-top:8px; line-height:1.4;">
                    ${schemaGuide.tip}
                </div>
            `;
        } else if (t.category !== "auto") {
            // 自定义新增分类的提示
            guideDiv.className = "schema-guide-card";
            guideDiv.style.background = "rgba(255,255,255,0.02)";
            guideDiv.style.border = "1px dashed var(--border-color)";
            guideDiv.style.borderRadius = "8px";
            guideDiv.style.padding = "12px";
            guideDiv.style.marginTop = "10px";
            guideDiv.style.marginBottom = "10px";
            guideDiv.innerHTML = `
                <div style="font-size:12px; font-weight:700; color: #fff; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-code" style="color: #64ffda; font-size:13px;"></i>
                    <span>✨ 自定义大平层提取 物理数仓 Schema 提示</span>
                </div>
                <p style="font-size:11px; color:var(--text-muted); line-height:1.4; margin:0;">
                    系统支持热插拔、高弹性自定义分类。为了与 BigQuery 历史黄金大表和 BQCA 智脑完美融和，请确保您的自定义 Prompt 输出的 JSON 中至少包含：<code>doc_title</code> (标题)、<code>parties</code> (签署相关主体) 以及 <code>summary</code> (中文内容总结)。其他特定业务属性将全自动塞入 dynamic_attributes 大平层。
                </p>
            `;
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

            // =========================================================================
            // 💡 方案一：新增一键恢复原厂 Prompt 气囊 (Official Reset Button)
            // =========================================================================
            const officialPrompt = DEFAULT_OFFICIAL_PROMPTS[t.category];
            if (officialPrompt) {
                const resetBtn = document.createElement("button");
                resetBtn.className = "sec-btn";
                resetBtn.style.borderColor = "#10b981";
                resetBtn.style.color = "#10b981";
                resetBtn.style.marginLeft = "10px";
                resetBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> 恢复官方原厂 Prompt`;
                resetBtn.onclick = () => {
                    showConfirmDialog(
                        "恢复官方原厂 Prompt",
                        `确定要将 "${t.display_name}" 分类的提示词恢复为 Google 官方精密预设吗？您做出的自定义修改将被覆盖。`,
                        () => {
                            textarea.value = officialPrompt.trim();
                            showToast("已热加载官方预设", "官方 Prompt 模板已成功反填至文本框 ── <b>请注意：您需要点击「保存模板修改」按钮以将其存入数据库生效！</b>", "info");
                        }
                    );
                };
                // 挂载在保存按钮右侧
                ctrlDiv.appendChild(resetBtn);
            }
            
            // 允许删除非系统内置核心分类
            if (!["contract", "resume", "invoice", "other"].includes(t.category)) {
                const delBtn = document.createElement("button");
                delBtn.className = "sec-btn";
                delBtn.style.borderColor = "var(--accent-pink)";
                delBtn.style.color = "var(--accent-pink)";
                delBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> 删除此分类`;
                delBtn.onclick = () => {
                    showConfirmDialog(
                        "物理删除分类模板",
                        `确定要物理删除 "${t.display_name}" 分类模板吗？这将从数仓逻辑中彻底移除该路由！`,
                        async () => {
                            const success = await deleteTemplateFromBackend(t.category);
                            if (success) {
                                showToast("删除分类成功", `分类模板 <strong>${t.display_name}</strong> 已安全移除。`, "success");
                                await fetchTemplates();
                            } else {
                                showToast("删除分类失败", "删除分类模板失败！", "error");
                            }
                        }
                    );
                };
                ctrlDiv.appendChild(delBtn);
            }
        }
        
        div.appendChild(textarea);
        if (t.category !== "auto") {
            div.appendChild(guideDiv); // 提示卡片面板完美插入
        }
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
                
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px;">
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
                    <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:12px; font-weight:600; color: var(--text-muted);">💡 BQCA 智能体绑定 ID (GCP Agent ID)</label>
                        <input type="text" id="gcp-input-agent-id" style="background:#0f1124; border:1px solid var(--border-color); color:#fff; padding:10px; border-radius:8px; font-size:12px;" placeholder="例如: ecommerce-analyst-cn">
                        <span style="font-size:10px; color:#f59e0b; display: flex; align-items: center; gap: 4px; margin-top: 2px; opacity: 0.85;">
                            <i class="fa-solid fa-triangle-exclamation"></i> 仅支持 global 区域的代理，其他区域暂不支持自动绑定
                        </span>
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
            <div class="modal-card" style="max-width: 460px; background: #0b0c16; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 12px 40px rgba(0,0,0,0.6); border-radius: 12px;">
                <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.06); padding: 18px 20px;">
                    <h3 style="margin:0; font-size:15px; color:#fff; display:flex; align-items:center; gap:8px; font-weight: 700;">
                        <i class="fa-solid fa-wand-magic-sparkles" style="color: #64ffda;"></i> ➕ 智能新增场景提取分类
                    </h3>
                    <button class="close-btn" id="template-modal-close" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="modal-body" style="padding: 20px; display: flex; flex-direction: column; gap: 18px;">
                    
                    <!-- 1. 分类展示名称 (全中文语义) -->
                    <div class="form-group">
                        <label style="display:block; font-size:12px; font-weight:600; color:#fff; margin-bottom:8px; display:flex; align-items:center; gap:4px;">
                            <span style="color:#64ffda;">*</span> 新增分类名称 (中文)
                        </label>
                        <input type="text" id="input-tpl-name" placeholder="例如: 专利文件、工程周报、诊断报告" style="background:#0f1124; border:1px solid rgba(255,255,255,0.12); color:#fff; padding:11px 14px; border-radius:8px; width:100%; font-size:12.5px; outline:none; transition: border 0.2s;">
                    </div>

                    <!-- 2. 精美业务勾选清单 (纯业务中文语义，屏蔽数据库术语) -->
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 14px; border-radius: 8px;">
                        <label style="display:block; font-size:12px; font-weight:600; color:#64ffda; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                            <i class="fa-solid fa-list-check"></i> 标配核心信息抽取 (系统已智能静默处理)
                        </label>
                        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11.5px; color: var(--text-muted); margin-bottom: 12px; border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 10px;">
                            <div style="display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-circle-check" style="color: #2ecc71;"></i> 文档主标题</div>
                            <div style="display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-circle-check" style="color: #2ecc71;"></i> 提及的关键参与主体与企业</div>
                            <div style="display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-circle-check" style="color: #2ecc71;"></i> 中文核心内容总结</div>
                            <div style="display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-circle-check" style="color: #2ecc71;"></i> <b>高保真原文审计比对证据链依据</b></div>
                        </div>

                        <!-- 业务可选勾选 -->
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #fff; cursor: pointer; user-select:none;">
                                <input type="checkbox" id="input-tpl-has-amount" checked style="accent-color: #64ffda; width:14px; height:14px;">
                                <span>此文档涉及交易金额、财务款项等数值</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #fff; cursor: pointer; user-select:none;">
                                <input type="checkbox" id="input-tpl-has-date" checked style="accent-color: #64ffda; width:14px; height:14px;">
                                <span>此文档涉及关键起止、开票或履约日期</span>
                            </label>
                        </div>
                    </div>

                    <!-- 3. 自定义专科字段极简输入区 (填表隔开体验) -->
                    <div class="form-group">
                        <label style="display:block; font-size:12px; font-weight:600; color:#fff; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                            <i class="fa-solid fa-cubes" style="color: #a29bfe;"></i> 场景专属特有属性 (如有，请用逗号隔开)
                        </label>
                        <input type="text" id="input-tpl-customs" placeholder="例如: 专利号, 发明人, 申请单位" style="background:#0f1124; border:1px solid rgba(255,255,255,0.12); color:#fff; padding:11px 14px; border-radius:8px; width:100%; font-size:12px; outline:none;">
                        <p style="font-size: 10.5px; color: var(--text-muted); margin: 6px 0 0 0; line-height: 1.4;">
                            💡 提示：输入您想要大模型定向提取的专属属性，系统将<b>自动进行智脑翻译与装配</b>，自动合拢入库并生成其对应的原文判定证据链！
                        </p>
                    </div>

                </div>
                <div class="modal-footer" style="border-top: 1px solid rgba(255,255,255,0.06); padding: 14px 20px; display:flex; justify-content:flex-end; gap:12px; background: rgba(0,0,0,0.15); border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;">
                    <button class="sec-btn" id="btn-cancel-tpl" style="font-size: 12px; padding: 8px 16px; border-radius:6px;">取消</button>
                    <button class="sparkle-btn" id="btn-save-tpl" style="font-size: 12px; padding:8px 22px; background: linear-gradient(135deg, #64ffda, #10b981); border:none; color:#0b0c16; border-radius:6px; cursor:pointer; font-weight:700; display:flex; align-items:center; gap:4px;">
                        <i class="fa-solid fa-bolt"></i> 智能装配并落库
                    </button>
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
                
                const agentInput = document.getElementById("gcp-input-agent-id");
                if (agentInput) {
                    agentInput.value = result.data.bqca_agent_id || "";
                }
                
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
            
            const agentIdEl = document.getElementById("gcp-input-agent-id");
            const bqcaAgentId = agentIdEl ? agentIdEl.value.trim() : "";

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
                        bq_connection_name: connectionName,
                        bqca_agent_id: bqcaAgentId
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
                        bq_connection_name: connectionName,
                        bqca_agent_id: bqcaAgentId
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
    document.getElementById("template-modal-close").onclick = () => {
        templateModal.classList.add("hidden");
        document.getElementById("custom-fields-container").innerHTML = "";
    };
    document.getElementById("btn-cancel-tpl").onclick = () => {
        templateModal.classList.add("hidden");
        document.getElementById("custom-fields-container").innerHTML = "";
    };

    // 💡 智能一键自动装配与落库
    document.getElementById("btn-save-tpl").onclick = async (e) => {
        e.preventDefault();
        const name = document.getElementById("input-tpl-name").value.trim();

        if (!name) {
            showToast("输入提示", "请输入要新增的分类名称（例如：专利文件）！", "warning");
            return;
        }

        // 1. 自动生成一个 100% 唯一的后台小写英文 Key (防冲突，彻底屏蔽英文 Key 复杂度)
        const timestamp = Date.now().toString().slice(-5);
        const randomStr = Math.floor(Math.random() * 100).toString();
        const key = "tpl_" + timestamp + "_" + randomStr;

        // 2. 收集用户勾选的业务开关
        const hasAmount = document.getElementById("input-tpl-has-amount").checked;
        const hasDate = document.getElementById("input-tpl-has-date").checked;

        // 3. 收集用户在输入框内填写的特有属性列表 (用逗号隔开)
        const customsInput = document.getElementById("input-tpl-customs").value.trim();
        const customKeys = customsInput
            ? customsInput.split(/[,，]/).map(x => x.trim()).filter(x => x.length > 0)
            : [];

        // 4. 🧠 智脑装配器：全中文业务语义，大模型直觉理解率 100%，且 BQ JSON 完全兼容中文 Key！
        let dynamicAttrObj = {};
        let customEvidencesHtml = "";
        customKeys.forEach(attr => {
            dynamicAttrObj[attr] = `提取文档中提及的${attr}内容`;
            customEvidencesHtml += `\n    "${attr}": "确定${attr}的原文条款段落与依据原句",`;
        });

        // 金额与日期控制
        const amountLine = hasAmount ? `  "amount": 10000.00,\n  "currency": "CNY",` : `  "amount": null,\n  "currency": "CNY",`;
        const amountEvidenceLine = hasAmount ? `\n    "amount": "确定交易/财务金额的原文依据条款原句",\n    "currency": "确定计价货币的原文依据条款原句",` : "";

        const dateLine = hasDate ? `  "key_dates": {\n    "关键日期项名称": "YYYY-MM-DD"\n  },` : `  "key_dates": {},\n`;
        const dateEvidenceLine = hasDate ? `\n    "key_dates": "确定关联关键日期的原文依据原句",` : "";

        const assembledPrompt = `你是一位极其严谨的资深“${name}”分析与审核专家。请仔细审阅这份文件。
你的任务是精确提取文件的核心信息，严格以标准的纯 JSON 格式输出，格式如下：
{
  "doc_title": "文件主标题",
  "parties": ["相关主体/提及的企业或人名"],
  ${dateLine}
  ${amountLine}
  "summary": "关于本篇${name}的核心内容一句话精简摘要（100字内）",
  "dynamic_attributes": ${JSON.stringify(dynamicAttrObj, null, 2).split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n')},
  "confidence_score": "high",
  "evidence": {
    "doc_title": "确定文档标题的原文段落依据",
    "parties": "确定相关关键主体的原文依据原句",${dateEvidenceLine}${amountEvidenceLine}${customEvidencesHtml}
    "summary": "确定核心摘要或内容的原文依据原句"
  }
}

【提取及原文判定证据链硬约束】：
1. 必须在 "evidence" 对象中，为上述提取出来的每一个字段（包含 dynamic_attributes 里的专属属性）提供在原文中一字不漏的「原文判定来源与依据原句」。
2. 原文依据需具体到对应段落（例如：“根据第几段：... ），绝对不可含糊编造。若无原文提及，请写“未在原文中提及”。`;

        // 5. 提交后端落库
        const success = await saveTemplateToBackend(key, name, assembledPrompt);
        if (success) {
            showToast("智能装配成功", `已成功自动智能装配并保存新分类：<strong>${name}</strong>！`, "success");
            templateModal.classList.add("hidden");
            // 重置输入框
            document.getElementById("input-tpl-name").value = "";
            document.getElementById("input-tpl-customs").value = "";
            await fetchTemplates();
        } else {
            showToast("一键添加失败", "保存分类模板至后台数据库失败！", "error");
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
    btnTriggerAnalyze.disabled = true;

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
// 7. GCS Signed URL 网盘拖拽上传/点击唤起双轨 Workflow
// -------------------------------------------------------------------------
// 💡 【物理唤起大国重器】支持直接点击拖拽区域，无缝唤起本地文件系统选择框进行直传
dropzone.onclick = () => {
    if (!dropzone.classList.contains("disabled")) {
        fileInput.click();
    }
};

fileInput.onchange = async () => {
    if (dropzone.classList.contains("disabled") || !currentWorkspace) return;
    
    const files = fileInput.files;
    if (files.length === 0) return;

    for (let file of files) {
        await uploadFileToGCS(file);
    }
    
    // 清空选择，确保下一次选择同一个文件能 100% 触发 change 直传
    fileInput.value = "";
};

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

        const { upload_url, gcs_uri, fallback_upload } = result.data;

        let uploadRes;
        if (fallback_upload) {
            // 2. 自愈中转：如果环境不支持 V4 签署（如 ADC 模式），调用本地后端中转接口
            document.querySelector(".upload-text").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在通过本地自愈中转上传至 GCS (0%)...`;
            
            const formData = new FormData();
            formData.append("file", file);
            
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${API_BASE}${upload_url}`, true);
            
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    document.querySelector(".upload-text").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在通过本地自愈中转上传至 GCS (${percent}%)...`;
                }
            };
            
            const uploadPromise = new Promise((resolve, reject) => {
                xhr.onload = () => resolve({ status: xhr.status });
                xhr.onerror = () => reject(new Error("自愈中转上传失败"));
            });
            
            xhr.send(formData);
            uploadRes = await uploadPromise;
        } else {
            // 2. 直传 GCS：PUT 请求直传二进制流到谷歌 GCS (100% 绕过 Python 服务器，极速、零带宽开销)
            document.querySelector(".upload-text").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在安全直传二进制流至 GCS 桶中 (0%)...`;
            uploadRes = await axiosPutWithProgress(upload_url, file);
        }

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
            // 💡 防呆保护：空间中检测到存在上传好的文件，立刻活化分析按钮
            btnTriggerAnalyze.disabled = false;
            
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
            // 💡 防呆保护：空间中暂无任何可分析文件，无条件禁用一键分析大按钮，杜绝盲目误触
            btnTriggerAnalyze.disabled = true;
            netdiskFileList.innerHTML = `<li class="empty-list-hint">空间内暂无上传文件</li>`;
        }
    } catch (e) {
        btnTriggerAnalyze.disabled = true;
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
    const maxAttempts = 12; // 最多轮询 1 分钟
    let isTerminated = false;

    async function doPoll() {
        if (isTerminated) return;
        attempts++;
        if (attempts > maxAttempts) {
            showToast("编译时间较长", "提取视图热重构编译较慢，系统将在后台继续，请稍后手动刷新列表。", "warning", 6000);
            resetAnalyzeButtonState();
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/api/workspace/results/${currentWorkspace}`);
            const result = await res.json();

            // 🧪 状态驱动精准熔断
            if (result.success && result.status && result.status !== "running") {
                isTerminated = true; // 立即将终结锁置为 true，拦截一切并发重入
                analysisResults = result.data || [];
                renderAnalysisTable();
                resetAnalyzeButtonState();
                if (result.status === "done") {
                    showToast("提取 & 编译完成", "两阶段自适应大模型分析已完成，拆列提取结果已完美呈现且在 BigQuery 就绪！", "success", 5000);
                } else if (result.status === "error") {
                    showToast("分析发生部分异常", "大模型在后台执行编译视图时遭遇报错，已安全降级，请检查底座配置或刷新重试。", "warning", 6000);
                }
                return; // 满足结束条件，物理终止递归
            }
        } catch (e) {
            console.error("轮询异常:", e);
        }

        // 如果未被终结且还在 running，5秒后启动下一次，天然 100% 物理串行！
        if (!isTerminated) {
            setTimeout(doPoll, 5000);
        }
    }

    // 延时 5 秒启动首次串行轮询
    setTimeout(doPoll, 5000);
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
        if (result.success && result.data && result.data.length > 0) {
            analysisResults = result.data;
            renderAnalysisTable();
        } else {
            // 💡 空间完全物理隔离：当切换到一个完全没有分析结果的空白空间时，必须彻底物理清空已核对历史和分析数据缓存！
            analysisResults = [];
            renderAnalysisTable();
            analysisTableBody.innerHTML = `<tr><td colspan="6" class="table-empty-hint">请上传文件并点击“一键大模型提取”按钮开始分析</td></tr>`;
        }
    } catch (e) {
        console.error(e);
    }
}

function renderAnalysisTable() {
    // 1. 清空上层待审核、下层已审核历史两个 tbody
    analysisTableBody.innerHTML = "";
    historyTableBody.innerHTML = "";

    let pendingCount = 0;
    let approvedCount = 0;

    // 2. 遍历整个 analysisResults 数据源，做物理双轨重绘
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

        if (row.parse_status !== "approved") {
            // 🚨 【待审核队列 (Pending)】
            pendingCount++;
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
        } else {
            // 🚨 【已审核黄金物理大表 (Approved Historical)】
            approvedCount++;
            tr.innerHTML = `
                <td><span class="badge badge-bq" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3); color: #10b981;">${row.doc_type.toUpperCase()}</span></td>
                <td style="font-weight: 500; color: rgba(255,255,255,0.65); text-decoration: line-through; text-decoration-color: rgba(16,185,129,0.2);">${row.doc_title}</td>
                <td style="font-family: monospace; color: #10b981;">${moneyDisplay}</td>
                <td>
                    <span class="status-pill ${statusClass}" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.2);">
                        <i class="fa-solid ${statusIcon}"></i> 已物理归档
                    </span>
                </td>
                <td><span class="confidence-badge ${confClass}">${row.confidence_score.toUpperCase()}</span></td>
                <td>
                    <button class="primary-btn" style="padding: 6px 12px; font-size: 11px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.85);" onclick="openHumanReview(${index})">
                        <i class="fa-solid fa-magnifying-glass"></i> 查阅
                    </button>
                </td>
            `;
            historyTableBody.appendChild(tr);
        }
    });

    // 3. 空值兜底占位提示
    if (pendingCount === 0) {
        analysisTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="table-empty-hint" style="color: #10b981; background: rgba(16,185,129,0.02); border: 1px dashed rgba(16,185,129,0.15); padding: 24px;">
                    <i class="fa-solid fa-circle-check"></i> 当前空间内所有上传文件均已完成大模型提取并精准落库，物理待核对队列已全部清空！
                </td>
            </tr>
        `;
    }
    if (approvedCount === 0) {
        historyTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="table-empty-hint" style="padding: 24px;">
                    当前空间暂无已审核归档记录，请点击上方“待审核”文件中的【核对并通过】完成首单物理归档。
                </td>
            </tr>
        `;
    }
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
    document.getElementById("hil-parties").value = data.parties ? (Array.isArray(data.parties) ? data.parties.join(", ") : data.parties) : "";
    document.getElementById("hil-amount").value = data.amount || "";
    document.getElementById("hil-currency").value = data.currency || "CNY";
    document.getElementById("hil-summary").value = data.summary;
    
    // 🧪 【自适应表单生长器】核心拼装
    const dynFormContainer = document.getElementById("hil-dynamics-form-container");
    dynFormContainer.innerHTML = "";
    
    // 初始化本地修改对象
    let currentDynamics = { ...data.dynamic_attributes };
    document.getElementById("hil-dynamics").value = JSON.stringify(currentDynamics, null, 2);

    // 动态生成输入框
    if (currentDynamics && Object.keys(currentDynamics).length > 0) {
        for (let key in currentDynamics) {
            const formGroup = document.createElement("div");
            formGroup.style = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;";
            
            // 翻译字段名称（中英文映射，提升非极客用户的易读性）
            let labelText = key;
            if (key === "buyer") labelText = "采购方 / 甲方 (buyer)";
            else if (key === "seller") labelText = "供货方 / 乙方 (seller)";
            else if (key === "delivery_deadline") labelText = "最晚交货期 (delivery_deadline)";
            else if (key === "warranty_years") labelText = "质保期 (warranty_years)";
            else if (key === "job_title") labelText = "应聘岗位 (job_title)";
            else if (key === "skills") labelText = "核心技术栈 (skills)";

            formGroup.innerHTML = `
                <label style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 2px;">${labelText}</label>
                <input type="text" class="dyn-input-field" data-key="${key}" value="${currentDynamics[key] || ""}" 
                       style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 8px; color: #fff; font-size: 12px; outline: none; transition: all 0.3s;" />
            `;
            
            const inputNode = formGroup.querySelector("input");
            
            // (A) 事件监听 1：动态向后兼容回写
            inputNode.oninput = function(e) {
                currentDynamics[key] = e.target.value;
                document.getElementById("hil-dynamics").value = JSON.stringify(currentDynamics, null, 2);
            };
            
            // (B) 事件监听 2：聚焦时一键高亮左侧对应的证据引用段
            inputNode.onfocus = function() {
                inputNode.style.border = "1px solid var(--accent-pink)";
                inputNode.style.background = "rgba(236, 72, 153, 0.05)";
                // 一键定位左侧证据
                const evItem = document.getElementById(`evidence-item-${key}`);
                if (evItem) {
                    evItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    evItem.style.background = "rgba(236, 72, 153, 0.15)";
                    evItem.style.border = "1px solid var(--accent-pink)";
                    evItem.style.boxShadow = "0 0 10px rgba(236, 72, 153, 0.3)";
                }
            };
            
            // (C) 事件监听 3：失焦恢复
            inputNode.onblur = function() {
                inputNode.style.border = "1px solid rgba(255,255,255,0.1)";
                inputNode.style.background = "rgba(255,255,255,0.05)";
                const evItem = document.getElementById(`evidence-item-${key}`);
                if (evItem) {
                    evItem.style.background = "rgba(255,255,255,0.03)";
                    evItem.style.border = "1px solid rgba(255,255,255,0.08)";
                    evItem.style.boxShadow = "none";
                }
            };

            dynFormContainer.appendChild(formGroup);
        }
    } else {
        dynFormContainer.innerHTML = `<div style="font-size:11px; color:rgba(255,255,255,0.4); text-align:center; padding: 12px 0;">该分类模板无特有自定义属性。</div>`;
    }

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
            block.id = `evidence-item-${key}`; // 为一键对应提供物理 ID
            block.style = "background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 10px; margin-bottom: 10px; transition: all 0.3s;";
            block.innerHTML = `
                <div class="evidence-field" style="font-size: 11px; color: var(--accent-pink); font-weight:600; margin-bottom: 4px;"><i class="fa-solid fa-quote-left"></i> ${key} 提取依据</div>
                <div class="evidence-quote" style="font-size: 12px; color: rgba(255,255,255,0.85); line-height: 1.4;">“${evidenceObj[key]}”</div>
            `;
            evidenceContainer.appendChild(block);
        }
    } else {
        evidenceContainer.innerHTML = `<div class="empty-list-hint">大模型该分类未输出具体引用证据。</div>`;
    }

    // 2.5 💡 如果是已审核状态，则将表单及提交按钮置为只读/禁用，确立落库安全规范
    const isApproved = data.parse_status === "approved";
    btnHilSubmit.disabled = isApproved;
    if (isApproved) {
        btnHilSubmit.innerHTML = `<i class="fa-solid fa-lock"></i> 物理数据已安全落库 (只读查阅)`;
        btnHilSubmit.style.background = "rgba(255,255,255,0.04)";
        btnHilSubmit.style.borderColor = "rgba(255,255,255,0.08)";
        btnHilSubmit.style.color = "rgba(255,255,255,0.4)";
    } else {
        btnHilSubmit.innerHTML = `<i class="fa-solid fa-circle-check"></i> 确认无误，精准归档落库`;
        btnHilSubmit.style.background = ""; 
        btnHilSubmit.style.borderColor = "";
        btnHilSubmit.style.color = "";
    }

    document.getElementById("hil-title").readOnly = isApproved;
    document.getElementById("hil-parties").readOnly = isApproved;
    document.getElementById("hil-amount").readOnly = isApproved;
    document.getElementById("hil-currency").readOnly = isApproved;
    document.getElementById("hil-summary").readOnly = isApproved;

    const dynInputs = dynFormContainer.querySelectorAll(".dyn-input-field");
    dynInputs.forEach(input => {
        input.readOnly = isApproved;
        if (isApproved) {
            input.style.background = "rgba(255,255,255,0.02)";
            input.style.color = "rgba(255,255,255,0.5)";
        }
    });

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
        dynamic_attributes: JSON.parse(document.getElementById("hil-dynamics").value),
        evidence: analysisResults[currentReviewIndex].evidence || {}
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
            showToast("人工核对完成", "系统已成功在 BigQuery 部署黄金物理结果大表，并秒级完成 GCS 文件冷温物理剪切归档！", "success", 5000);
            
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
            
            // 💡 秒级全物理联动：落库后文件已在 GCS 端被物理剪切，立即重载左栏云网盘源文件列表，让已被处理的 PDF 瞬间消失
            fetchFileList();
        } else {
            showToast("绑定物理表失败", result.detail || result.message || "未知错误", "error");
        }
    } catch (e) {
        showToast("物理归档异常", "核对提交异常，无法写入物理结果表，请检查网络！", "error");
    } finally {
        btnHilSubmit.innerHTML = `<i class="fa-solid fa-circle-check"></i> 确认无误，精准归档落库`;
        btnHilSubmit.disabled = false;
    }
};


