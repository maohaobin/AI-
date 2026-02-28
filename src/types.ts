export interface Project {
  id: string;
  name: string;
  description: string;
}

export interface DataEntry {
  id: number;
  project_id: string;
  content: string;
  category: string;
}

export interface Message {
  role: 'user' | 'model' | 'system';
  content: string;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
