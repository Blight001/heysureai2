<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  isOpen: boolean
  allFiles: string[]
  selectedFiles: string[]
  currentPath: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'navigate', path: string): void
  (e: 'navigateBack'): void
  (e: 'toggle', file: string): void
  (e: 'clear'): void
  (e: 'refresh'): void
}>()

const normalizedAllFiles = computed(() => props.allFiles.map(file => file.replace(/\\/g, '/')))
const normalizedSelectedFiles = computed(() => props.selectedFiles.map(file => file.replace(/\\/g, '/')))

const currentFolderItems = computed(() => {
  const items = new Set<string>()
  const folders = new Set<string>()
  
  normalizedAllFiles.value.forEach(file => {
    const isDir = file.endsWith('/')
    const cleanPath = isDir ? file.slice(0, -1) : file

    if (props.currentPath === '') {
      const parts = cleanPath.split('/')
      if (parts.length > 1 || isDir) folders.add(parts[0])
      else if (parts[0]) items.add(parts[0])
    } else {
      if (cleanPath.startsWith(props.currentPath + '/')) {
        const relative = cleanPath.slice(props.currentPath.length + 1)
        if (!relative) return
        const parts = relative.split('/')
        if (parts.length > 1 || isDir) folders.add(parts[0])
        else if (parts[0]) items.add(parts[0])
      }
    }
  })
  
  return {
    folders: Array.from(folders).sort(),
    files: Array.from(items).sort()
  }
})

const navigateTo = (folder: string) => {
  emit('navigate', folder)
}

const isFileSelected = (file: string) => {
  const fullPath = props.currentPath === '' ? file : `${props.currentPath}/${file}`
  return normalizedSelectedFiles.value.includes(fullPath)
}
</script>

<template>
  <div v-if="isOpen" class="absolute bottom-full left-0 mb-2 w-64 bg-white border border-zinc-200 rounded-xl shadow-xl dark:bg-zinc-900 dark:border-zinc-700 z-[100] overflow-hidden flex flex-col max-h-[400px]">
    <div class="p-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/50">
      <div class="flex items-center gap-1 overflow-hidden">
        <button v-if="currentPath" @click="emit('navigateBack')" class="p-1 hover:bg-zinc-200 rounded dark:hover:bg-zinc-700 transition-colors">
          ⬅️
        </button>
        <span class="text-[10px] font-mono text-zinc-500 truncate">{{ currentPath || '根目录' }}</span>
      </div>
      <button @click="emit('close')" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 w-6 h-6 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800">
        ×
      </button>
    </div>
    
    <div class="overflow-y-auto p-1 custom-scrollbar">
      <div v-if="currentFolderItems.folders.length === 0 && currentFolderItems.files.length === 0" class="p-4 text-center text-[10px] text-zinc-400">
        空文件夹
      </div>
      
      <!-- Folders -->
      <div v-for="folder in currentFolderItems.folders" :key="'f-'+folder" 
           @click="navigateTo(folder)"
           class="flex items-center gap-2 p-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg cursor-pointer group transition-colors">
        <span class="text-sm">📁</span>
        <span class="text-[11px] text-zinc-700 dark:text-zinc-300 group-hover:text-indigo-600 font-medium">{{ folder }}</span>
        <span class="ml-auto text-[10px] text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">⟩</span>
      </div>
      
      <!-- Files -->
      <div v-for="file in currentFolderItems.files" :key="'fi-'+file" 
           class="flex items-center gap-2 p-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg cursor-pointer transition-colors"
           @click.stop="emit('toggle', file)">
        <input type="checkbox" :checked="isFileSelected(file)" class="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer">
        <span class="text-sm">📄</span>
        <span class="text-[11px] text-zinc-600 dark:text-zinc-400 truncate group-hover:text-zinc-900 dark:group-hover:text-zinc-200">{{ file }}</span>
      </div>
    </div>

    <div class="p-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/80 flex justify-between items-center">
      <span class="text-[10px] text-zinc-500 font-medium">已选 {{ selectedFiles.length }}</span>
      <div class="flex gap-2">
        <button @click="emit('refresh')" class="text-[10px] text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-2 py-1 rounded transition-colors">
          🔄 刷新
        </button>
        <button @click="emit('clear')" class="text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded transition-colors">
          清空
        </button>
      </div>
    </div>
  </div>
</template>
