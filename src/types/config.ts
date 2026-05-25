// Cospace v2.0 配置系统类型定义

/**
 * 全局配置 (~/.cospace/config.json)
 */
export interface GlobalConfig {
  /** 知识资产路径配置 */
  assets: {
    /** 文档模板库路径 */
    templates: string;
    /** 数据文件路径 */
    data: string;
    /** 参考资料路径 */
    references: string;
    /** 历史案例路径 */
    cases: string;
    /** 自动化脚本路径（可选） */
    scripts?: string;
  };

  /** 工作流模板库路径 */
  workflows?: string;

  /** 默认工作流模板名称 */
  defaultWorkflow?: string;

  /** Agent 配置 */
  agent?: {
    /** 默认 Agent 类型 */
    type: 'claude' | 'codex' | 'custom';
    /** 是否自动启动 Agent */
    autoStart: boolean;
    /** 自定义命令（当 type 为 custom 时） */
    customCommand?: string;
  };

  /** LLM 配置（用于意图解析和提示词优化） */
  llm?: {
    /** LLM 提供商 */
    provider: 'zhipu' | 'deepseek' | 'aliyun' | 'anthropic' | 'openai' | 'custom';
    /** API Key */
    apiKey: string;
    /** 自定义 Base URL（可选） */
    baseUrl?: string;
    /** 模型名称 */
    model: string;
  };

  /** 搜索配置 */
  search?: {
    /** 搜索提供者 */
    providers?: SearchProvider[];
  };

  /** UI 配置 */
  ui?: {
    /** 主题 */
    theme?: 'dark' | 'light' | 'system';
    /** 侧边栏宽度 */
    sidebarWidth?: number;
    /** 预览面板宽度 */
    previewWidth?: number;
  };
}

/**
 * 搜索提供者配置
 */
export interface SearchProvider {
  /** 提供者名称 */
  name: string;
  /** 提供者类型 */
  type: 'local' | 'api';
  /** 本地路径（当 type 为 local 时） */
  path?: string;
  /** API 地址（当 type 为 api 时） */
  url?: string;
}

/**
 * 任务级配置 (任务/.cospace/config.json)
 * 可以覆盖全局配置
 */
export interface TaskConfig extends Partial<GlobalConfig> {
  /** 任务专属工作流定义文件路径（相对于任务目录） */
  workflow?: string;

  /** 任务元数据 */
  metadata?: {
    /** 任务名称 */
    name: string;
    /** 任务类型 */
    type: 'proposal' | 'report' | 'article' | 'contract' | 'custom';
    /** 任务描述 */
    description?: string;
    /** 创建时间 */
    createdAt?: number;
  };
}

/**
 * 合并后的配置（任务级覆盖全局）
 */
export interface MergedConfig extends GlobalConfig {
  /** 是否是任务级配置 */
  isTaskLevel: boolean;
  /** 任务级配置路径（如果有） */
  taskConfigPath?: string;
}

/**
 * 默认全局配置
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  assets: {
    templates: '~/notebook/templates',
    data: '~/notebook/data',
    references: '~/notebook/references',
    cases: '~/notebook/cases',
  },
  workflows: '~/.cospace/workflows',
  defaultWorkflow: 'standard-4stage',
  agent: {
    type: 'claude',
    autoStart: true,
  },
  llm: {
    provider: 'zhipu',
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    model: 'glm-4-flash',
  },
  ui: {
    theme: 'dark',
    sidebarWidth: 200,
    previewWidth: 450,
  },
};

/**
 * 工作流配置类型
 */
export interface WorkflowConfig {
  /** 元数据 */
  metadata: {
    name: string;
    type: 'proposal' | 'report' | 'article' | 'contract' | 'custom';
    version: string;
    description?: string;
  };

  /** 阶段定义 */
  stages: StageConfig[];
}

/**
 * 阶段配置
 */
export interface StageConfig {
  /** 阶段唯一标识 */
  id: string;
  /** 阶段显示名称 */
  name: string;
  /** 阶段说明 */
  description: string;

  /** 是否可选 */
  optional?: boolean;
  /** 是否可跳过 */
  skippable?: boolean;

  /** 依赖的前置阶段 */
  depends?: string | string[];

  /** 阶段产出文档定义 */
  outputs: StageOutput[];

  /** Agent 上下文模板（支持模板变量） */
  agentContext: string;
}

/**
 * 阶段产出定义
 */
export interface StageOutput {
  /** 产出名称 */
  name: string;
  /** 产出文档相对路径 */
  path: string;
  /** 模板路径（可选） */
  template?: string;
  /** 文件格式 */
  format?: 'md' | 'docx' | 'pdf' | 'txt';
}

/**
 * 任务状态（存储在 task.json 中）
 */
export interface TaskState {
  /** 任务 ID */
  id: string;
  /** 当前阶段索引 */
  currentStageIndex: number;
  /** 当前阶段 ID */
  currentStageId: string;
  /** 各阶段状态 */
  stageStatus: Record<string, StageStatus>;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间 */
  lastAccessed: number;
}

/**
 * 阶段状态
 */
export interface StageStatus {
  /** 状态 */
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 产出文档路径 */
  outputs?: string[];
}

/**
 * 路径解析工具类型
 */
export interface PathResolution {
  /** 原始路径（可能包含 ~） */
  original: string;
  /** 解析后的绝对路径 */
  resolved: string;
  /** 是否存在 */
  exists: boolean;
}
