import streamlit as st
import json
import os
import re
import subprocess
from pathlib import Path
from openai import OpenAI

st.set_page_config(
    page_title="HeySure AI - Coding Assistant",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
    :root {
        --bg-primary: #0d1117;
        --bg-secondary: #161b22;
        --bg-tertiary: #21262d;
        --bg-hover: #30363d;
        --border-color: #30363d;
        --text-primary: #e6edf3;
        --text-secondary: #8b949e;
        --accent-blue: #58a6ff;
        --accent-green: #3fb950;
        --accent-red: #f85149;
        --accent-purple: #a371f7;
    }
    
    .stApp { background: var(--bg-primary); }
    
    footer {visibility: hidden;}
    #MainMenu {visibility: hidden;}
    
    section[data-testid="stSidebar"] {
        width: 300px !important;
        min-width: 300px !important;
        background: var(--bg-secondary) !important;
        border-right: 1px solid var(--border-color) !important;
    }
    
    section[data-testid="stSidebar"] > div {
        background: var(--bg-secondary) !important;
    }
    
    section[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] {
        color: var(--text-primary) !important;
    }
    
    section[data-testid="stSidebar"] .element-container {
        color: var(--text-primary) !important;
    }
    
    section[data-testid="stSidebar"] label {
        color: var(--text-primary) !important;
    }
    
    .stChatMessage {
        background: var(--bg-secondary) !important;
    }
    
    .stChatMessage p, .stChatMessage div, .stChatMessage span {
        color: var(--text-primary) !important;
    }
    
    .stChatMessage {
        min-height: 60px;
    }
    
    .main .block-container {
        padding-top: 2rem;
        padding-bottom: 2rem;
    }
    
    .drawer-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border-color);
    }
    
    .stExpander {
        background: var(--bg-tertiary) !important;
        border: 1px solid var(--border-color) !important;
        border-radius: 6px !important;
    }
    
    .stTextInput > div > div > input {
        background: var(--bg-primary) !important;
        border-color: var(--border-color) !important;
        color: var(--text-primary) !important;
    }
    
    .stCheckbox {
        color: var(--text-primary) !important;
    }
    
    .stButton > button {
        background: var(--accent-blue) !important;
        color: white !important;
        border: none !important;
        border-radius: 6px !important;
    }
    
    .stButton > button:hover {
        background: #4c9aed !important;
    }
    
    .block-container {
        padding-top: 1rem !important;
        padding-left: 0.5rem !important;
        padding-right: 0.5rem !important;
    }
    
    [data-testid="stVerticalBlock"] {
        gap: 0.5rem !important;
    }
</style>
""", unsafe_allow_html=True)

def generate_file_tree(path, prefix="", max_depth=3, current_depth=0, selected_files=None):
    if selected_files is None:
        selected_files = []
    if current_depth >= max_depth:
        return ""
    tree = ""
    try:
        items = sorted(os.listdir(path))
        dirs = [i for i in items if os.path.isdir(os.path.join(path, i)) and not i.startswith('.')]
        files = [i for i in items if os.path.isfile(os.path.join(path, i)) and not i.startswith('.')]
        
        for i, d in enumerate(dirs):
            is_last = (i == len(dirs) + len(files) - 1)
            tree += f"{prefix}{'└── ' if is_last else '├── '}{d}/\n"
            if current_depth < max_depth - 1:
                extension = "    " if is_last else "│   "
                tree += generate_file_tree(os.path.join(path, d), prefix + extension, max_depth, current_depth + 1, selected_files)
        
        for i, f in enumerate(files):
            is_last = (i == len(files) - 1)
            marker = "✓ " if f in selected_files else ""
            tree += f"{prefix}{'└── ' if is_last else '├── '}{marker}{f}\n"
    except PermissionError:
        pass
    return tree

def get_all_files(path, max_depth=3, current_depth=0, base_path=None):
    files = []
    if base_path is None:
        base_path = path
    if current_depth >= max_depth:
        return files
    try:
        items = sorted(os.listdir(path))
        for item in items:
            full_path = os.path.join(path, item)
            if os.path.isfile(full_path) and not item.startswith('.'):
                rel_path = os.path.relpath(full_path, base_path)
                files.append(rel_path)
            elif os.path.isdir(full_path) and not item.startswith('.'):
                files.extend(get_all_files(full_path, max_depth, current_depth + 1, base_path))
    except PermissionError:
        pass
    return files

def get_git_info(path):
    try:
        result = subprocess.run(["git", "status", "--porcelain"], cwd=path, capture_output=True, text=True, timeout=10)
        diff_content = subprocess.run(["git", "diff"], cwd=path, capture_output=True, text=True, timeout=10)
        return result.stdout.strip().split("\n") if result.stdout.strip() else [], diff_content.stdout
    except Exception:
        return [], None

def parse_ai_blocks(text):
    blocks = []
    patterns = [
        ("edit", r"File:\s*[`]?([^\s`]+)[`]?\s*\n<<<<<<< SEARCH\n(.*?)\n=======\n(.*?)\n>>>>>>> REPLACE"),
        ("create", r"File:\s*[`]?([^\s`]+)[`]?\s*\n<<<<<<< CREATE\n(.*?)\n>>>>>>> CREATE"),
        ("delete", r"File:\s*[`]?([^\s`]+)[`]?\s*\n<<<<<<< DELETE\n>>>>>>> DELETE"),
        ("run", r"<<<<<<< RUN\n(.*?)\n>>>>>>> RUN"),
    ]
    
    for block_type, pattern in patterns:
        for match in re.finditer(pattern, text, re.DOTALL):
            if block_type == "edit":
                blocks.append({"type": "edit", "filename": match.group(1), "search": match.group(2), "replace": match.group(3)})
            elif block_type == "create":
                blocks.append({"type": "create", "filename": match.group(1), "content": match.group(2)})
            elif block_type == "delete":
                blocks.append({"type": "delete", "filename": match.group(1)})
            elif block_type == "run":
                blocks.append({"type": "run", "command": match.group(1).strip()})
    
    return blocks

def parse_ai_response(text):
    blocks = parse_ai_blocks(text)
    
    think_pattern = r"<<(.*?)>>"
    think_match = re.search(think_pattern, text, re.DOTALL)
    think_content = think_match.group(1).strip() if think_match else None
    
    block_pattern = r"(File:\s*[`]?[^\s`]+[`]?\s*\n)?<<<<<<< (SEARCH|CREATE|DELETE|RUN)\n.*?\n>>>>>>> (REPLACE|CREATE|DELETE|RUN)"
    cleaned_text = re.sub(block_pattern, "", text, flags=re.DOTALL)
    cleaned_text = re.sub(think_pattern, "", cleaned_text, flags=re.DOTALL).strip()
    
    return {"think": think_content, "blocks": blocks, "display_text": cleaned_text}

def apply_edit(project_path, filename, search_content, replace_content):
    file_path = os.path.join(project_path, filename)
    if not os.path.exists(file_path):
        return False, f"File not found: {filename}"
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        if search_content not in content:
            return False, f"Could not find the SEARCH block in {filename}"
        new_content = content.replace(search_content, replace_content, 1)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True, f"Successfully modified {filename}"
    except Exception as e:
        return False, f"Error: {str(e)}"

def apply_create(project_path, filename, content):
    file_path = os.path.join(project_path, filename)
    if os.path.exists(file_path):
        return False, f"File already exists: {filename}"
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True, f"Successfully created {filename}"
    except Exception as e:
        return False, f"Error: {str(e)}"

def apply_delete(project_path, filename):
    file_path = os.path.join(project_path, filename)
    if not os.path.exists(file_path):
        return False, f"File not found: {filename}"
    try:
        os.remove(file_path)
        return True, f"Successfully deleted {filename}"
    except Exception as e:
        return False, f"Error: {str(e)}"

def execute_command(command, cwd):
    try:
        result = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True, timeout=60)
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", "Command timed out"
    except Exception as e:
        return False, "", str(e)

def execute_block(project_path, block):
    if block["type"] == "edit":
        return apply_edit(project_path, block["filename"], block["search"], block["replace"])
    elif block["type"] == "create":
        return apply_create(project_path, block["filename"], block["content"])
    elif block["type"] == "delete":
        return apply_delete(project_path, block["filename"])
    elif block["type"] == "run":
        success, stdout, stderr = execute_command(block["command"], project_path)
        if success:
            return True, f"Command executed:\n{stdout}"
        else:
            return False, f"Command failed:\n{stderr}"
    return False, "Unknown block type"

def call_ai_api(api_key, base_url, model, messages, stream=True):
    try:
        client = OpenAI(api_key=api_key, base_url=base_url)
        completion = client.chat.completions.create(
            model=model,
            stream=stream,
            messages=messages
        )
        return completion, None
    except Exception as e:
        return None, str(e)

if "messages" not in st.session_state:
    st.session_state.messages = []
if "pending_blocks" not in st.session_state:
    st.session_state.pending_blocks = []
if "is_executing" not in st.session_state:
    st.session_state.is_executing = False
if "need_ai_response" not in st.session_state:
    st.session_state.need_ai_response = False
if "selected_files" not in st.session_state:
    st.session_state.selected_files = []
if "prompt_templates" not in st.session_state:
    st.session_state.prompt_templates = {
        "代码审查": "请审查以下代码，找出潜在问题并提供改进建议：",
        "重构代码": "请重构以下代码，使其更清晰、更高效：",
        "添加注释": "请为以下代码添加详细的中文注释：",
        "编写测试": "请为以下代码编写单元测试：",
        "修复Bug": "请帮我修复以下代码中的bug：",
        "优化性能": "请优化以下代码的性能：",
    }
if "selected_template" not in st.session_state:
    st.session_state.selected_template = None
if "api_provider" not in st.session_state:
    st.session_state.api_provider = "deepseek"
if "custom_providers" not in st.session_state:
    st.session_state.custom_providers = []

MODEL_GROUPS = {
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/chat/completions",
        "models": ["deepseek-chat", "deepseek-coder"],
        "default_key": "sk-cb40bc0b0b894934919907913e337927"
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1/chat/completions",
        "models": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
        "default_key": ""
    },
    "aicode": {
        "name": "AICode",
        "base_url": "https://new.aicode.us.com/v1",
        "models": ["gpt-5-codex", "gpt-5.1-codex-mini", "gpt-5.2", "gpt-5.2-codex", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini"],
        "default_key": "sk-RuYDdZlJQYDAdiQI7cE0BcE7C2D04976997b93E404932eC1"
    }
}

with st.sidebar:
    st.markdown("### 🎛️ 控制面板")
    
    st.markdown("---")
    
    st.markdown("**📝 Prompt 模板**")
    for name, template in st.session_state.prompt_templates.items():
        if st.button(f"📌 {name}", key=f"template_{name}", use_container_width=True):
            st.session_state.selected_template = name
    
    st.markdown("---")
    
    st.markdown("**🤖 模型配置**")
    
    provider_options = {k: v["name"] for k, v in MODEL_GROUPS.items()}
    selected_provider = st.selectbox(
        "选择 API 提供商",
        options=list(provider_options.keys()),
        format_func=lambda x: provider_options[x],
        index=list(provider_options.keys()).index(st.session_state.api_provider) if st.session_state.api_provider in provider_options else 0
    )
    st.session_state.api_provider = selected_provider
    
    provider_config = MODEL_GROUPS[selected_provider]
    
    api_key = st.text_input(
        "API Key",
        value=provider_config["default_key"],
        type="password",
        key=f"api_key_{selected_provider}"
    )
    
    base_url = st.text_input(
        "Base URL",
        value=provider_config["base_url"],
        key=f"base_url_{selected_provider}"
    )
    
    model = st.selectbox(
        "Model",
        options=provider_config["models"],
        index=0,
        key=f"model_{selected_provider}"
    )
    
    st.markdown("---")
    
    st.markdown("**📁 项目路径**")
    project_path = st.text_input("Project Path", value=os.getcwd())
    
    st.markdown("---")
    
    st.markdown("**📁 文件选择**")
    include_git_diff = st.checkbox("Include Git Diff", value=False)
    include_file_tree = st.checkbox("Include File Tree", value=True)
    
    if os.path.exists(project_path):
        all_files = get_all_files(project_path)
        st.markdown(f"*共 {len(all_files)} 个文件*")
        
        with st.expander("📂 选择文件", expanded=False):
            for idx, f in enumerate(all_files[:50]):
                is_selected = f in st.session_state.selected_files
                safe_key = f"file_{idx}_{f.replace(os.sep, '_').replace('.', '_').replace(' ', '_')}"
                if st.checkbox(f, value=is_selected, key=safe_key):
                    if f not in st.session_state.selected_files:
                        st.session_state.selected_files.append(f)
                else:
                    if f in st.session_state.selected_files:
                        st.session_state.selected_files.remove(f)
    
    st.markdown("---")
    
    st.markdown("**🌳 项目结构**")
    if os.path.exists(project_path):
        tree = generate_file_tree(project_path, selected_files=st.session_state.selected_files)
        st.code(tree, language="text")
    
    st.markdown("---")
    
    if st.button("🗑️ 清空对话", use_container_width=True):
        st.session_state.messages = []
        st.session_state.pending_blocks = []
        st.session_state.is_executing = False
        st.session_state.need_ai_response = False
        st.rerun()

with st.container():
    if st.session_state.messages:
        message = st.session_state.messages[-1]
        role = message["role"]
        if role == "tool":
            role = "assistant"
        
        with st.chat_message(role):
            if message["role"] == "assistant":
                parsed = parse_ai_response(message["content"])
                
                if parsed["display_text"]:
                    st.markdown(parsed["display_text"])
                
                if parsed["blocks"]:
                    for block in parsed["blocks"]:
                        if block["type"] == "edit":
                            st.info(f"✏️ 编辑: {block['filename']}")
                        elif block["type"] == "create":
                            st.info(f"📄 创建: {block['filename']}")
                        elif block["type"] == "delete":
                            st.info(f"🗑️ 删除: {block['filename']}")
                        elif block["type"] == "run":
                            st.info(f"⚡ 执行: {block['command'][:60]}...")
                
                if message.get("execution_log"):
                    for log in message["execution_log"]:
                        if log["success"]:
                            st.success(f"✅ {log['message']}")
                        else:
                            st.error(f"❌ {log['message']}")
            elif message["role"] == "tool":
                st.markdown(message['content'])
            else:
                st.markdown(message["content"])
    else:
        st.markdown("### 💬 开始新的对话")
        st.markdown("在下方输入框中输入你的问题...")
    
    default_prompt = ""
    if st.session_state.selected_template:
        default_prompt = st.session_state.prompt_templates[st.session_state.selected_template]
        st.session_state.selected_template = None
    
    if prompt := st.chat_input("输入你的问题...", key="main_chat_input"):
        file_context = ""
        if include_file_tree and os.path.exists(project_path):
            tree = generate_file_tree(project_path, selected_files=st.session_state.selected_files)
            file_context = f"\n### 项目结构:\n```\n{tree}\n```\n"
        
        if st.session_state.selected_files:
            file_context += f"\n### 选中的文件:\n{', '.join(st.session_state.selected_files)}\n"
        
        git_context = ""
        if include_git_diff:
            changed, diff = get_git_info(project_path)
            if diff:
                git_context = f"\n### Git Diff:\n```diff\n{diff}\n```\n"
        
        combined_context = f"{file_context}{git_context}".strip()
        full_prompt = f"{prompt}\n\n{combined_context}" if combined_context else prompt
        
        system_content = """You are a coding assistant with access to the user's project.
When you need to make changes, use the following formats:

**EDIT existing file:**
File: path/to/file.py
<<<<<<< SEARCH
[code to replace]
=======
[new code]
>>>>>>> REPLACE

**CREATE new file:**
File: path/to/newfile.py
<<<<<<< CREATE
[new file content]
>>>>>>> CREATE

**DELETE existing file:**
File: path/to/file.py
<<<<<<< DELETE
>>>>>>> DELETE

**RUN command:**
<<<<<<< RUN
your command here
>>>>>>> RUN

IMPORTANT: Execute actions one at a time. After each action, report the result and wait for confirmation before proceeding with the next action."""

        api_messages = [{"role": "system", "content": system_content}]
        api_messages.append({"role": "user", "content": full_prompt})
        
        st.session_state.messages = [{"role": "user", "content": prompt}]
        st.session_state.pending_blocks = []
        st.session_state.need_ai_response = False
        
        try:
            completion, error = call_ai_api(api_key, base_url, model, api_messages, stream=True)
            if error:
                st.error(f"Error: {error}")
            else:
                full_response = ""
                response_container = st.empty()
                
                for chunk in completion:
                    if chunk.choices and len(chunk.choices) > 0:
                        delta = chunk.choices[0].delta
                        content = delta.content if delta.content else ""
                        full_response += content
                        response_container.markdown(full_response + "▌")
                
                response_container.markdown(full_response)
                st.session_state.messages.append({"role": "assistant", "content": full_response})
                
                parsed = parse_ai_response(full_response)
                if parsed["blocks"]:
                    st.session_state.pending_blocks = parsed["blocks"]
                    st.rerun()
            
        except Exception as e:
            st.error(f"Error: {str(e)}")
    
    if st.session_state.pending_blocks and not st.session_state.is_executing:
        st.session_state.is_executing = True
        
        all_blocks = list(st.session_state.pending_blocks)
        st.session_state.pending_blocks = []
        execution_log = []
        total_blocks = len(all_blocks)
        
        for idx, block in enumerate(all_blocks):
            block_desc = f"{block['type']} - {block.get('filename') or block.get('command', '')[:30]}"
            with st.spinner(f"执行中 ({idx+1}/{total_blocks}): {block_desc}"):
                try:
                    success, message = execute_block(project_path, block)
                except Exception as e:
                    success = False
                    message = f"Execution exception: {str(e)}"
                
                execution_log.append({
                    "type": block["type"],
                    "success": success,
                    "message": message,
                    "block": block
                })
        
        if st.session_state.messages and st.session_state.messages[-1]["role"] == "assistant":
            st.session_state.messages[-1]["execution_log"] = execution_log
        
        execution_summary = "\n### 执行结果:\n"
        for log in execution_log:
            status = "成功" if log["success"] else "失败"
            execution_summary += f"- [{status}] {log['message']}\n"
        
        st.session_state.messages.append({
            "role": "tool", 
            "content": execution_summary.strip()
        })
        
        st.session_state.is_executing = False
        st.session_state.need_ai_response = True
        st.rerun()
    
    if st.session_state.need_ai_response and not st.session_state.is_executing:
        st.session_state.need_ai_response = False
        
        system_content = """You are a coding assistant with access to the user's project.
When you need to make changes, use the following formats:

**EDIT existing file:**
File: path/to/file.py
<<<<<<< SEARCH
[code to replace]
=======
[new code]
>>>>>>> REPLACE

**CREATE new file:**
File: path/to/newfile.py
<<<<<<< CREATE
[new file content]
>>>>>>> CREATE

**DELETE existing file:**
File: path/to/file.py
<<<<<<< DELETE
>>>>>>> DELETE

**RUN command:**
<<<<<<< RUN
your command here
>>>>>>> RUN

IMPORTANT: Execute actions one at a time. After each action, report the result and wait for confirmation before proceeding with the next action."""

        api_messages = [{"role": "system", "content": system_content}]
        for m in st.session_state.messages:
            role = m["role"]
            content = m["content"]
            if role == "tool":
                role = "user"
                content = f"Tool execution results:\n{content}\n\nContinue with the next action if needed."
            api_messages.append({"role": role, "content": content})
        
        try:
            completion, error = call_ai_api(api_key, base_url, model, api_messages, stream=True)
            if error:
                st.error(f"Error: {error}")
            else:
                full_response = ""
                response_container = st.empty()
                
                for chunk in completion:
                    if chunk.choices and len(chunk.choices) > 0:
                        delta = chunk.choices[0].delta
                        content = delta.content if delta.content else ""
                        full_response += content
                        response_container.markdown(full_response + "▌")
                
                response_container.markdown(full_response)
                st.session_state.messages.append({"role": "assistant", "content": full_response})
                
                parsed = parse_ai_response(full_response)
                if parsed["blocks"]:
                    st.session_state.pending_blocks = parsed["blocks"]
                    st.rerun()
            
        except Exception as e:
            st.error(f"Error: {str(e)}")


