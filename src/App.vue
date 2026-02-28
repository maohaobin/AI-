<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { 
  MessageSquare, 
  Settings, 
  Plus, 
  Trash2, 
  Send, 
  Database as DbIcon,
  ChevronRight,
  Loader2,
  Briefcase
} from 'lucide-vue-next';
import { Project, DataEntry, Message } from './types';
import { chatWithProject } from './services/geminiService';

const activeTab = ref<'chat' | 'admin'>('chat');
const projects = ref<Project[]>([]);
const selectedProject = ref<Project | null>(null);
const messages = ref<Message[]>([]);
const input = ref('');
const isLoading = ref(false);
const hasApiKey = ref(true);

const checkApiKey = async () => {
  if (window.aistudio) {
    hasApiKey.value = await window.aistudio.hasSelectedApiKey();
  }
};

const handleOpenKeyDialog = async () => {
  if (window.aistudio) {
    await window.aistudio.openSelectKey();
    hasApiKey.value = true; // Assume success and proceed
  }
};

// Admin State
const newProject = ref({ id: '', name: '', description: '' });
const projectData = ref<DataEntry[]>([]);
const newDataEntry = ref({ content: '', category: '常规' });
const externalSources = ref<any[]>([]);
const editingSourceId = ref<number | null>(null);
const testResult = ref<any>(null);
const isTesting = ref(false);
const showParamEditor = ref<number | null>(null);
const showTestModal = ref(false);
const activeTestSource = ref<any>(null);
const testDynamicValues = ref<Record<string, string>>({});
const isExecutingTest = ref(false);
const isSavingTestData = ref(false);
const testExecutionResult = ref<any>(null);

const handleSaveTestDataToProject = async () => {
  if (!selectedProject.value || !testExecutionResult.value?.data) return;
  
  isSavingTestData.value = true;
  try {
    const content = typeof testExecutionResult.value.data === 'object' 
      ? JSON.stringify(testExecutionResult.value.data) 
      : String(testExecutionResult.value.data);

    await fetch(`/api/projects/${selectedProject.value.id}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content,
        category: activeTestSource.value?.category || '外部数据'
      })
    });
    alert('数据已成功同步到项目！AI 现在可以检索到这些信息了。');
    fetchProjectData(selectedProject.value.id);
  } catch (e) {
    alert('保存失败');
  } finally {
    isSavingTestData.value = false;
  }
};
const testMode = ref<'server' | 'browser' | 'manual'>('server');
const manualJsonInput = ref('');

const handleManualSync = () => {
  try {
    const data = JSON.parse(manualJsonInput.value);
    testExecutionResult.value = { success: true, data };
  } catch (e) {
    alert('JSON 格式错误，请检查是否完整复制。');
  }
};
const sourceParams = ref<any[]>([]);
const newParam = ref({
  name: '',
  description: '',
  type: 'string',
  required: false,
  format: ''
});

const newSource = ref({
  name: '',
  url: '',
  method: 'GET',
  paramsList: [] as { key: string, value: string }[],
  headersList: [] as { key: string, value: string }[],
  category: '常规',
  description: ''
});

const addParamRow = () => {
  newSource.value.paramsList.push({ key: '', value: '' });
};

const removeParamRow = (index: number) => {
  newSource.value.paramsList.splice(index, 1);
};

const addHeaderRow = () => {
  newSource.value.headersList.push({ key: '', value: '' });
};

const removeHeaderRow = (index: number) => {
  newSource.value.headersList.splice(index, 1);
};

const listToObj = (list: { key: string, value: string }[]) => {
  const obj: any = {};
  list.forEach(item => {
    if (item.key.trim()) obj[item.key.trim()] = item.value;
  });
  return JSON.stringify(obj);
};

const objToList = (jsonStr: string) => {
  try {
    const obj = JSON.parse(jsonStr || '{}');
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
  } catch (e) {
    return [];
  }
};

const chatEndRef = ref<HTMLDivElement | null>(null);

const fetchProjects = async () => {
  const res = await fetch('/api/projects');
  const data = await res.json();
  projects.value = data;
  if (data.length > 0 && !selectedProject.value) {
    selectedProject.value = data[0];
  }
};

const fetchProjectData = async (id: string) => {
  const res = await fetch(`/api/projects/${id}/data`);
  const data = await res.json();
  projectData.value = data;
};

const fetchExternalSources = async (id: string) => {
  const res = await fetch(`/api/projects/${id}/sources`);
  const data = await res.json();
  externalSources.value = data;
};

onMounted(async () => {
  await checkApiKey();
  fetchProjects();
});

watch(selectedProject, (newVal) => {
  if (newVal) {
    fetchProjectData(newVal.id);
    fetchExternalSources(newVal.id);
    messages.value = [{ role: 'system', content: `已连接到项目：${newVal.name}。今天我能帮您什么？` }];
  }
});

watch(messages, () => {
  nextTick(() => {
    chatEndRef.value?.scrollIntoView({ behavior: 'smooth' });
  });
}, { deep: true });

const handleAddProject = async () => {
  if (!newProject.value.id || !newProject.value.name) return;
  await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newProject.value)
  });
  newProject.value = { id: '', name: '', description: '' };
  fetchProjects();
};

const handleAddDataEntry = async () => {
  if (!selectedProject.value || !newDataEntry.value.content) return;
  await fetch(`/api/projects/${selectedProject.value.id}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newDataEntry.value)
  });
  newDataEntry.value = { content: '', category: '常规' };
  fetchProjectData(selectedProject.value.id);
};

const handleAddSource = async () => {
  if (!selectedProject.value || !newSource.value.url) return;
  
  const payload = {
    ...newSource.value,
    params: listToObj(newSource.value.paramsList),
    headers: listToObj(newSource.value.headersList)
  };

  if (editingSourceId.value) {
    await fetch(`/api/sources/${editingSourceId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    editingSourceId.value = null;
  } else {
    await fetch(`/api/projects/${selectedProject.value.id}/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  
  newSource.value = { name: '', url: '', method: 'GET', paramsList: [], headersList: [], category: '常规', description: '' };
  fetchExternalSources(selectedProject.value.id);
};

const handleEditSource = (source: any) => {
  editingSourceId.value = source.id;
  newSource.value = {
    name: source.name,
    url: source.url,
    method: source.method,
    paramsList: objToList(source.params),
    headersList: objToList(source.headers),
    category: source.category,
    description: source.description || ''
  };
};

const cancelEdit = () => {
  editingSourceId.value = null;
  testResult.value = null;
  newSource.value = { name: '', url: '', method: 'GET', paramsList: [], headersList: [], category: '常规', description: '' };
};

const fetchSourceParams = async (sourceId: number) => {
  const res = await fetch(`/api/sources/${sourceId}/params`);
  sourceParams.value = await res.json();
};

const handleOpenParamEditor = (sourceId: number) => {
  showParamEditor.value = sourceId;
  fetchSourceParams(sourceId);
};

const handleAddParam = async () => {
  if (!showParamEditor.value || !newParam.value.name) return;
  await fetch(`/api/sources/${showParamEditor.value}/params`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newParam.value)
  });
  newParam.value = { name: '', description: '', type: 'string', required: false, format: '' };
  fetchSourceParams(showParamEditor.value);
};

const handleDeleteParam = async (paramId: number) => {
  await fetch(`/api/params/${paramId}`, { method: 'DELETE' });
  if (showParamEditor.value) fetchSourceParams(showParamEditor.value);
};

const handleOpenTestModal = async (source: any) => {
  activeTestSource.value = source;
  testExecutionResult.value = null;
  testDynamicValues.value = {};
  testMode.value = 'server';
  
  // Fetch params to check for required ones
  const res = await fetch(`/api/sources/${source.id}/params`);
  const params = await res.json();
  sourceParams.value = params;

  const hasRequired = params.some((p: any) => p.required);
  
  if (hasRequired) {
    showTestModal.value = true;
  } else {
    // No required params, run test directly
    runTestExecution();
  }
};

const runTestExecution = async () => {
  if (!activeTestSource.value) return;
  
  // Validate required params
  const missing = sourceParams.value.filter(p => p.required && !testDynamicValues.value[p.name]);
  if (missing.length > 0) {
    alert(`请填写必填参数: ${missing.map(p => p.name).join(', ')}`);
    return;
  }

  isExecutingTest.value = true;
  testExecutionResult.value = null;
  
  try {
    if (testMode.value === 'server') {
      const res = await fetch(`/api/sources/execute/${activeTestSource.value.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testDynamicValues.value)
      });
      const data = await res.json();
      testExecutionResult.value = data;
    } else {
      // Browser-side fetch
      const headers = JSON.parse(activeTestSource.value.headers || '{}');
      const staticParams = JSON.parse(activeTestSource.value.params || '{}');
      const finalParams = { ...staticParams, ...testDynamicValues.value };
      
      const fetchOptions: any = {
        method: activeTestSource.value.method,
        headers: headers,
      };

      let url = activeTestSource.value.url;
      if (activeTestSource.value.method === 'GET') {
        const queryParams = new URLSearchParams(finalParams).toString();
        if (queryParams) url += (url.includes('?') ? '&' : '?') + queryParams;
      } else {
        fetchOptions.body = JSON.stringify(finalParams);
        fetchOptions.headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      testExecutionResult.value = { success: true, data };
    }
    
    if (!showTestModal.value) {
      showTestModal.value = true;
    }
  } catch (e: any) {
    testExecutionResult.value = { 
      success: false, 
      error: testMode.value === 'browser' 
        ? `浏览器请求失败: ${e.message}。请检查接口是否允许跨域 (CORS) 或网络是否通畅。` 
        : e.message 
    };
    showTestModal.value = true;
  } finally {
    isExecutingTest.value = false;
  }
};

const handleTestConnection = async () => {
  if (!newSource.value.url) return;
  isTesting.value = true;
  testResult.value = null;
  
  const payload = {
    ...newSource.value,
    params: listToObj(newSource.value.paramsList),
    headers: listToObj(newSource.value.headersList)
  };

  try {
    const res = await fetch('/api/sources/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    testResult.value = data;
  } catch (e: any) {
    testResult.value = { success: false, error: e.message };
  } finally {
    isTesting.value = false;
  }
};

const handleFetchSource = async (id: number) => {
  isLoading.value = true;
  try {
    const res = await fetch(`/api/sources/${id}/fetch`, { method: 'POST' });
    if (res.ok) {
      if (selectedProject.value) {
        fetchProjectData(selectedProject.value.id);
      }
      alert('数据同步成功！');
    } else {
      const err = await res.json();
      alert(`同步失败: ${err.error}`);
    }
  } catch (e) {
    alert('同步发生错误');
  } finally {
    isLoading.value = false;
  }
};

const handleDeleteSource = async (id: number) => {
  await fetch(`/api/sources/${id}`, { method: 'DELETE' });
  if (selectedProject.value) fetchExternalSources(selectedProject.value.id);
};

const handleDeleteData = async (id: number) => {
  await fetch(`/api/data/${id}`, { method: 'DELETE' });
  if (selectedProject.value) fetchProjectData(selectedProject.value.id);
};

const handleSendMessage = async () => {
  if (!input.value.trim() || !selectedProject.value || isLoading.value) return;

  const userMsg = input.value;
  input.value = '';
  messages.value.push({ role: 'user', content: userMsg });
  isLoading.value = true;

  try {
    const response = await chatWithProject(selectedProject.value.id, selectedProject.value.name, userMsg);
    messages.value.push({ role: 'model', content: response || 'AI 未返回任何内容。' });
  } catch (error) {
    console.error(error);
    messages.value.push({ role: 'model', content: '错误：获取响应失败。' });
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="flex h-screen bg-[#F5F5F4] text-[#1C1917] font-sans">
    <!-- API Key Selection Overlay -->
    <div v-if="!hasApiKey" class="fixed inset-0 z-[100] bg-white flex items-center justify-center p-6">
      <div class="max-w-md w-full space-y-6 text-center">
        <div class="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto">
          <Settings class="w-8 h-8" />
        </div>
        <div class="space-y-2">
          <h2 class="text-2xl font-bold text-[#141414]">需要配置 API Key</h2>
          <p class="text-[#78716C] text-sm">
            当前免费额度已耗尽或需要更高的配额。请选择您的付费 Google Cloud 项目 API Key 以继续使用。
          </p>
          <p class="text-xs text-[#A8A29E]">
            查看 <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" class="underline">计费文档</a> 了解更多。
          </p>
        </div>
        <button 
          @click="handleOpenKeyDialog"
          class="w-full bg-black text-white rounded-xl py-3 font-bold hover:bg-zinc-800 transition-all shadow-lg"
        >
          选择 API Key
        </button>
      </div>
    </div>

    <!-- Sidebar -->
    <aside class="w-64 bg-white border-r border-[#E7E5E4] flex flex-col">
      <div class="p-6 border-b border-[#E7E5E4]">
        <div class="flex items-center gap-2 mb-1">
          <div class="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <Briefcase class="w-5 h-5 text-white" />
          </div>
          <h1 class="font-bold text-lg tracking-tight">项目洞察</h1>
        </div>
        <p class="text-xs text-[#78716C] font-medium uppercase tracking-wider">AI 数据助手</p>
      </div>

      <nav class="flex-1 p-4 space-y-2 overflow-y-auto">
        <div class="px-2 py-1 text-[10px] font-bold text-[#A8A29E] uppercase tracking-widest">导航</div>
        <button 
          @click="activeTab = 'chat'"
          :class="['w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all', activeTab === 'chat' ? 'bg-[#F5F5F4] text-black font-medium shadow-sm' : 'text-[#57534E] hover:bg-[#FAFAF9]']"
        >
          <MessageSquare class="w-4 h-4" />
          对话
        </button>
        <button 
          @click="activeTab = 'admin'"
          :class="['w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all', activeTab === 'admin' ? 'bg-[#F5F5F4] text-black font-medium shadow-sm' : 'text-[#57534E] hover:bg-[#FAFAF9]']"
        >
          <Settings class="w-4 h-4" />
          配置中心
        </button>

        <div class="pt-6 px-2 py-1 text-[10px] font-bold text-[#A8A29E] uppercase tracking-widest">活跃项目</div>
        <button 
          v-for="p in projects"
          :key="p.id"
          @click="selectedProject = p"
          :class="['w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all text-sm', selectedProject?.id === p.id ? 'bg-black text-white shadow-md' : 'text-[#57534E] hover:bg-[#FAFAF9]']"
        >
          <span class="truncate">{{ p.name }}</span>
          <ChevronRight v-if="selectedProject?.id === p.id" class="w-3 h-3" />
        </button>
      </nav>

      <div class="p-4 border-t border-[#E7E5E4]">
        <div class="bg-[#F5F5F4] p-3 rounded-2xl">
          <p class="text-[10px] font-bold text-[#A8A29E] uppercase mb-1">系统状态</p>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span class="text-xs font-medium">在线</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <header class="h-16 bg-white border-b border-[#E7E5E4] flex items-center justify-between px-8">
        <div class="flex items-center gap-4">
          <h2 class="font-semibold text-lg">{{ activeTab === 'chat' ? '项目对话' : '项目配置' }}</h2>
          <span v-if="selectedProject" class="px-2 py-1 bg-[#F5F5F4] text-[#78716C] text-[10px] font-bold rounded-md uppercase">
            {{ selectedProject.name }}
          </span>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-8">
        <div v-if="activeTab === 'chat'" class="max-w-3xl mx-auto h-full flex flex-col">
          <div v-if="!selectedProject" class="flex-1 flex flex-col items-center justify-center text-center space-y-4">
            <div class="w-16 h-16 bg-[#F5F5F4] rounded-full flex items-center justify-center">
              <DbIcon class="w-8 h-8 text-[#A8A29E]" />
            </div>
            <div>
              <h3 class="font-bold text-xl">未选择项目</h3>
              <p class="text-[#78716C] max-w-xs">请在配置选项卡中选择或创建一个项目以开始对话。</p>
            </div>
          </div>
          <div v-else class="flex-1 flex flex-col">
            <div class="flex-1 space-y-6 pb-24">
              <div v-for="(m, i) in messages" :key="i" :class="['flex', m.role === 'user' ? 'justify-end' : 'justify-start']">
                <div :class="['max-w-[80%] p-4 rounded-2xl shadow-sm', 
                  m.role === 'user' ? 'bg-black text-white rounded-tr-none' : 
                  m.role === 'system' ? 'bg-[#F5F5F4] text-[#78716C] text-xs italic border border-[#E7E5E4]' : 
                  'bg-white border border-[#E7E5E4] rounded-tl-none']">
                  <p class="text-sm leading-relaxed whitespace-pre-wrap">{{ m.content }}</p>
                </div>
              </div>
              <div v-if="isLoading" class="flex justify-start">
                <div class="bg-white border border-[#E7E5E4] p-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                  <Loader2 class="w-4 h-4 animate-spin text-black" />
                  <span class="text-sm font-medium">正在检索项目数据...</span>
                </div>
              </div>
              <div ref="chatEndRef" />
            </div>

            <!-- Chat Input -->
            <div class="fixed bottom-8 left-64 right-0 px-8">
              <form @submit.prevent="handleSendMessage" class="max-w-3xl mx-auto relative group">
                <input 
                  type="text"
                  v-model="input"
                  :placeholder="`询问关于 ${selectedProject.name} 的问题...`"
                  class="w-full bg-white border border-[#E7E5E4] rounded-2xl px-6 py-4 pr-16 shadow-lg focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                />
                <button 
                  type="submit"
                  :disabled="!input.trim() || isLoading"
                  class="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
                >
                  <Send class="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>

        <div v-else class="max-w-5xl mx-auto space-y-8">
          <!-- Project Management -->
          <section class="bg-white rounded-3xl border border-[#E7E5E4] p-8 shadow-sm">
            <div class="flex items-center justify-between mb-6">
              <div>
                <h3 class="font-bold text-xl">项目管理</h3>
                <p class="text-sm text-[#78716C]">创建和管理您的项目上下文。</p>
              </div>
            </div>
            
            <form @submit.prevent="handleAddProject" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 p-4 bg-[#F5F5F4] rounded-2xl">
              <input 
                placeholder="项目 ID (例如 contract-2024)"
                class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none"
                v-model="newProject.id"
              />
              <input 
                placeholder="项目名称"
                class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none"
                v-model="newProject.name"
              />
              <button type="submit" class="bg-black text-white rounded-xl px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors">
                <Plus class="w-4 h-4" /> 添加项目
              </button>
            </form>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div v-for="p in projects" :key="p.id" :class="['p-4 rounded-2xl border transition-all', selectedProject?.id === p.id ? 'border-black bg-black/5' : 'border-[#E7E5E4]']">
                <div class="flex justify-between items-start mb-2">
                  <h4 class="font-bold">{{ p.name }}</h4>
                  <span class="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-[#E7E5E4]">{{ p.id }}</span>
                </div>
                <p class="text-xs text-[#78716C] mb-4">{{ p.description || '暂无描述。' }}</p>
                <button 
                  @click="selectedProject = p"
                  class="text-xs font-bold uppercase tracking-wider hover:underline"
                >
                  管理数据
                </button>
              </div>
            </div>
          </section>

          <!-- Data Management -->
          <section v-if="selectedProject" class="bg-white rounded-3xl border border-[#E7E5E4] p-8 shadow-sm">
            <div class="flex items-center justify-between mb-6">
              <div>
                <h3 class="font-bold text-xl">{{ selectedProject.name }} 的数据</h3>
                <p class="text-sm text-[#78716C]">添加 AI 可以检索的知识条目。</p>
              </div>
            </div>

            <form @submit.prevent="handleAddDataEntry" class="space-y-4 mb-8">
              <div class="flex gap-4">
                <select 
                  class="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none"
                  v-model="newDataEntry.category"
                >
                  <option>常规</option>
                  <option>财务</option>
                  <option>法务</option>
                  <option>时间线</option>
                  <option>团队</option>
                </select>
                <input 
                  placeholder="输入数据点 (例如：2024年总收入为 120 万美元)"
                  class="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none"
                  v-model="newDataEntry.content"
                />
                <button type="submit" class="bg-black text-white rounded-xl px-6 py-2 text-sm font-medium hover:bg-zinc-800 transition-colors">
                  添加条目
                </button>
              </div>
            </form>

            <div class="space-y-3">
              <div v-for="d in projectData" :key="d.id" class="group flex items-center justify-between p-4 bg-[#F5F5F4] rounded-2xl hover:bg-[#E7E5E4] transition-colors">
                <div class="flex items-center gap-4">
                  <span class="px-2 py-1 bg-white border border-[#E7E5E4] text-[10px] font-bold rounded uppercase text-[#78716C]">
                    {{ d.category }}
                  </span>
                  <p class="text-sm">{{ d.content }}</p>
                </div>
                <button 
                  @click="handleDeleteData(d.id)"
                  class="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:bg-red-50 transition-all rounded-lg"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
              <div v-if="projectData.length === 0" class="text-center py-12 border-2 border-dashed border-[#E7E5E4] rounded-3xl">
                <p class="text-[#A8A29E] text-sm">该项目暂无数据条目。</p>
              </div>
            </div>
          </section>

          <!-- External Sources Management -->
          <section v-if="selectedProject" class="bg-white rounded-3xl border border-[#E7E5E4] p-8 shadow-sm">
            <div class="flex items-center justify-between mb-6">
              <div>
                <h3 class="font-bold text-xl">外部数据源 (API/MCP)</h3>
                <p class="text-sm text-[#78716C]">配置外部接口，自动同步项目数据。</p>
              </div>
            </div>

            <form @submit.prevent="handleAddSource" class="space-y-4 mb-8 bg-[#F5F5F4] p-6 rounded-2xl">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input v-model="newSource.name" placeholder="数据源名称 (如：财务系统接口)" class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none" />
                <input v-model="newSource.url" placeholder="接口 URL (https://api.example.com/data)" class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none" />
              </div>
              <div class="grid grid-cols-1 gap-4">
                <input v-model="newSource.description" placeholder="数据源描述 (告诉 AI 这个接口是做什么的，例如：查询特定时间段的团队营收)" class="w-full bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none" />
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <select v-model="newSource.method" class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none">
                  <option>GET</option>
                  <option>POST</option>
                </select>
                <select v-model="newSource.category" class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none">
                  <option>常规</option>
                  <option>财务</option>
                  <option>法务</option>
                  <option>时间线</option>
                </select>
                <div class="flex gap-2">
                  <button type="submit" class="flex-1 bg-black text-white rounded-xl px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors">
                    <Plus v-if="!editingSourceId" class="w-4 h-4" /> 
                    {{ editingSourceId ? '保存修改' : '添加数据源' }}
                  </button>
                  <button 
                    @click="handleTestConnection" 
                    type="button" 
                    :disabled="isTesting"
                    class="px-4 py-2 border border-[#E7E5E4] rounded-xl text-sm font-medium hover:bg-[#F5F5F4] transition-colors flex items-center gap-2"
                  >
                    <Loader2 v-if="isTesting" class="w-3 h-3 animate-spin" />
                    测试连接
                  </button>
                  <button v-if="editingSourceId" @click="cancelEdit" type="button" class="px-4 py-2 border border-[#E7E5E4] rounded-xl text-sm font-medium hover:bg-[#F5F5F4] transition-colors">
                    取消
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-3">
                  <div class="flex items-center justify-between px-2">
                    <label class="text-[10px] font-bold text-[#A8A29E] uppercase">静态请求参数 (固定值)</label>
                    <button type="button" @click="addParamRow" class="text-[10px] text-emerald-600 font-bold hover:underline">+ 添加参数</button>
                  </div>
                  <div class="space-y-2">
                    <div v-for="(row, idx) in newSource.paramsList" :key="idx" class="flex gap-2">
                      <input v-model="row.key" placeholder="Key" class="flex-1 bg-white border border-[#E7E5E4] rounded-xl px-3 py-1.5 text-xs focus:outline-none" />
                      <input v-model="row.value" placeholder="Value" class="flex-1 bg-white border border-[#E7E5E4] rounded-xl px-3 py-1.5 text-xs focus:outline-none" />
                      <button type="button" @click="removeParamRow(idx)" class="p-1.5 text-red-400 hover:text-red-600">
                        <Trash2 class="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div v-if="newSource.paramsList.length === 0" class="text-center py-4 border border-dashed border-[#E7E5E4] rounded-xl text-[10px] text-[#A8A29E]">
                      无静态参数
                    </div>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="flex items-center justify-between px-2">
                    <label class="text-[10px] font-bold text-[#A8A29E] uppercase">请求头 (Headers)</label>
                    <button type="button" @click="addHeaderRow" class="text-[10px] text-emerald-600 font-bold hover:underline">+ 添加请求头</button>
                  </div>
                  <div class="space-y-2">
                    <div v-for="(row, idx) in newSource.headersList" :key="idx" class="flex gap-2">
                      <input v-model="row.key" placeholder="Header Name" class="flex-1 bg-white border border-[#E7E5E4] rounded-xl px-3 py-1.5 text-xs focus:outline-none" />
                      <input v-model="row.value" placeholder="Value" class="flex-1 bg-white border border-[#E7E5E4] rounded-xl px-3 py-1.5 text-xs focus:outline-none" />
                      <button type="button" @click="removeHeaderRow(idx)" class="p-1.5 text-red-400 hover:text-red-600">
                        <Trash2 class="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div v-if="newSource.headersList.length === 0" class="text-center py-4 border border-dashed border-[#E7E5E4] rounded-xl text-[10px] text-[#A8A29E]">
                      无自定义请求头
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Test Result Display -->
              <div v-if="testResult" class="mt-4 p-4 rounded-xl border text-xs font-mono overflow-auto max-h-48" :class="testResult.success ? 'bg-emerald-50 border-emerald-100 text-emerald-900' : 'bg-red-50 border-red-100 text-red-900'">
                <div class="flex justify-between items-center mb-2">
                  <span class="font-bold uppercase tracking-wider">{{ testResult.success ? '测试成功' : '测试失败' }}</span>
                  <button @click="testResult = null" class="hover:underline">关闭</button>
                </div>
                <pre>{{ testResult.success ? JSON.stringify(testResult.data, null, 2) : testResult.error }}</pre>
              </div>
            </form>

            <div class="space-y-3">
              <div v-for="s in externalSources" :key="s.id" class="flex items-center justify-between p-4 border border-[#E7E5E4] rounded-2xl bg-white hover:shadow-md transition-all">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <h4 class="font-bold text-sm">{{ s.name }}</h4>
                    <span class="text-[10px] bg-[#F5F5F4] px-2 py-0.5 rounded uppercase font-bold text-[#78716C]">{{ s.method }}</span>
                  </div>
                  <p class="text-xs text-[#78716C] truncate max-w-md">{{ s.url }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <button 
                    @click="handleOpenParamEditor(s.id)"
                    class="px-3 py-2 text-black bg-[#F5F5F4] hover:bg-[#E7E5E4] rounded-xl text-xs font-bold transition-colors"
                  >
                    配置动态参数
                  </button>
                  <button 
                    @click="handleEditSource(s)"
                    class="px-3 py-2 text-[#57534E] hover:bg-[#F5F5F4] rounded-xl text-xs font-bold transition-colors"
                  >
                    编辑
                  </button>
                  <button 
                    @click="handleOpenTestModal(s)"
                    class="px-3 py-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-colors"
                  >
                    测试连接
                  </button>
                  <button 
                    @click="handleFetchSource(s.id)"
                    class="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-colors"
                  >
                    <Loader2 v-if="isLoading" class="w-3 h-3 animate-spin" />
                    立即同步
                  </button>
                  <button 
                    @click="handleDeleteSource(s.id)"
                    class="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div v-if="externalSources.length === 0" class="text-center py-8 border-2 border-dashed border-[#E7E5E4] rounded-3xl">
                <p class="text-[#A8A29E] text-xs">暂无外部数据源。</p>
              </div>
            </div>
          </section>

          <!-- Dynamic Parameter Modal (Simple Overlay) -->
          <div v-if="showParamEditor" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]">
              <div class="p-6 border-b border-[#E7E5E4] flex justify-between items-center">
                <h3 class="font-bold text-xl">配置动态参数</h3>
                <button @click="showParamEditor = null" class="text-[#78716C] hover:text-black">关闭</button>
              </div>
              
              <div class="flex-1 overflow-y-auto p-6 space-y-6">
                <div class="bg-[#F5F5F4] p-4 rounded-2xl space-y-4">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">添加新参数</h4>
                  <div class="grid grid-cols-2 gap-3">
                    <input v-model="newParam.name" placeholder="参数名 (如: startTime)" class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none" />
                    <select v-model="newParam.type" class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none">
                      <option value="string">字符串</option>
                      <option value="number">数字</option>
                    </select>
                  </div>
                  <input v-model="newParam.description" placeholder="参数描述 (告诉 AI 这个参数代表什么)" class="w-full bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none" />
                  <div class="grid grid-cols-2 gap-3">
                    <input v-model="newParam.format" placeholder="格式建议 (如: YYYY-MM-DD)" class="bg-white border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none" />
                    <label class="flex items-center gap-2 px-4 py-2 bg-white border border-[#E7E5E4] rounded-xl text-sm cursor-pointer">
                      <input type="checkbox" v-model="newParam.required" />
                      <span>必填参数</span>
                    </label>
                  </div>
                  <button @click="handleAddParam" class="w-full bg-black text-white rounded-xl py-2 text-sm font-bold hover:bg-zinc-800 transition-colors">
                    添加参数定义
                  </button>
                </div>

                <div class="space-y-3">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">已定义参数</h4>
                  <div v-for="p in sourceParams" :key="p.id" class="flex items-center justify-between p-4 border border-[#E7E5E4] rounded-2xl">
                    <div>
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-bold text-sm">{{ p.name }}</span>
                        <span class="text-[10px] bg-[#F5F5F4] px-2 py-0.5 rounded uppercase font-bold">{{ p.type }}</span>
                        <span v-if="p.required" class="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded uppercase font-bold">必填</span>
                      </div>
                      <p class="text-xs text-[#78716C]">{{ p.description }} <span v-if="p.format" class="italic">(格式: {{ p.format }})</span></p>
                    </div>
                    <button @click="handleDeleteParam(p.id)" class="text-red-500 hover:bg-red-50 p-2 rounded-xl transition-colors">
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                  <div v-if="sourceParams.length === 0" class="text-center py-8 border-2 border-dashed border-[#E7E5E4] rounded-2xl">
                    <p class="text-[#A8A29E] text-xs">尚未定义动态参数。</p>
                  </div>
                </div>
              </div>
              
              <div class="p-6 border-t border-[#E7E5E4] flex justify-end">
                <button @click="showParamEditor = null" class="bg-black text-white px-8 py-2 rounded-xl font-bold">完成</button>
              </div>
            </div>
          </div>

          <!-- Test Execution Modal -->
          <div v-if="showTestModal" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[80vh]">
              <div class="p-6 border-b border-[#E7E5E4] flex justify-between items-center">
                <h3 class="font-bold text-xl">测试连接: {{ activeTestSource?.name }}</h3>
                <button @click="showTestModal = false" class="text-[#78716C] hover:text-black">关闭</button>
              </div>
              
              <div class="flex-1 overflow-y-auto p-6 space-y-6">
                <div class="bg-[#F5F5F4] p-4 rounded-2xl space-y-3">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">测试模式</h4>
                  <div class="flex gap-2 p-1 bg-white rounded-xl border border-[#E7E5E4]">
                    <button 
                      @click="testMode = 'server'"
                      :class="['flex-1 py-1.5 text-xs font-bold rounded-lg transition-all', testMode === 'server' ? 'bg-black text-white shadow-sm' : 'text-[#78716C] hover:bg-[#F5F5F4]']"
                    >
                      云端服务器 (真实环境)
                    </button>
                    <button 
                      @click="testMode = 'browser'"
                      :class="['flex-1 py-1.5 text-xs font-bold rounded-lg transition-all', testMode === 'browser' ? 'bg-black text-white shadow-sm' : 'text-[#78716C] hover:bg-[#F5F5F4]']"
                    >
                      本地浏览器 (内网调试)
                    </button>
                    <button 
                      @click="testMode = 'manual'"
                      :class="['flex-1 py-1.5 text-xs font-bold rounded-lg transition-all', testMode === 'manual' ? 'bg-black text-white shadow-sm' : 'text-[#78716C] hover:bg-[#F5F5F4]']"
                    >
                      手动粘贴 (保底方案)
                    </button>
                  </div>
                  <p class="text-[10px] text-[#78716C] leading-relaxed">
                    {{ testMode === 'server' ? '模拟 AI 调用的真实环境。如果接口在内网，此模式会失败。' : testMode === 'browser' ? '直接从您的浏览器发起请求。适用于测试内网 IP，但需确保接口已开启跨域 (CORS)。' : '如果上述方法都失败，您可以直接将浏览器中看到的 JSON 结果粘贴到下方。' }}
                  </p>
                </div>

                <div v-if="testMode === 'manual'" class="space-y-3">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">粘贴 JSON 数据</h4>
                  <textarea 
                    v-model="manualJsonInput" 
                    rows="8" 
                    placeholder='在此粘贴您在浏览器中看到的 {"data": ...} 结果'
                    class="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-4 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black/5"
                  ></textarea>
                  <button @click="handleManualSync" class="w-full bg-emerald-600 text-white rounded-xl py-2 text-xs font-bold hover:bg-emerald-700 transition-colors">
                    解析并预览数据
                  </button>
                </div>

                <div v-if="testMode !== 'manual' && sourceParams.length > 0" class="space-y-4">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">输入测试参数</h4>
                  <div v-for="p in sourceParams" :key="p.id" class="space-y-1">
                    <label class="text-xs font-medium flex items-center gap-1">
                      {{ p.name }}
                      <span v-if="p.required" class="text-red-500">*</span>
                      <span class="text-[10px] text-[#A8A29E] font-normal">({{ p.description }})</span>
                    </label>
                    <input 
                      v-model="testDynamicValues[p.name]"
                      :placeholder="p.format || '输入值...'"
                      class="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
                    />
                  </div>
                </div>

                <div v-if="testExecutionResult" class="space-y-2">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">返回结果</h4>
                  <div class="p-4 rounded-2xl border text-xs font-mono overflow-auto max-h-64" :class="testExecutionResult.success ? 'bg-emerald-50 border-emerald-100 text-emerald-900' : 'bg-red-50 border-red-100 text-red-900'">
                    <pre>{{ testExecutionResult.success ? JSON.stringify(testExecutionResult.data, null, 2) : testExecutionResult.error }}</pre>
                  </div>
                </div>
              </div>
              
              <div class="p-6 border-t border-[#E7E5E4] flex justify-end gap-3">
                <button @click="showTestModal = false" class="px-6 py-2 border border-[#E7E5E4] rounded-xl font-bold text-sm">取消</button>
                <button 
                  v-if="testExecutionResult?.success"
                  @click="handleSaveTestDataToProject"
                  :disabled="isSavingTestData"
                  class="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 transition-colors"
                >
                  <Loader2 v-if="isSavingTestData" class="w-4 h-4 animate-spin" />
                  同步到项目数据
                </button>
                <button 
                  @click="runTestExecution" 
                  :disabled="isExecutingTest"
                  class="bg-black text-white px-8 py-2 rounded-xl font-bold text-sm flex items-center gap-2"
                >
                  <Loader2 v-if="isExecutingTest" class="w-4 h-4 animate-spin" />
                  执行测试
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.chat-scroll-mask {
  mask-image: linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);
}
</style>
