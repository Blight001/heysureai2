# HeySure Windows 环境初始化

重装系统后，直接运行 `windows-run.bat`。启动器会自动检查并引导处理常见缺失项。

## 必需环境

- Python：推荐 Python 3.11 或 3.12  
  下载：https://www.python.org/downloads/windows/  
  安装时勾选 `Add python.exe to PATH`。

- PostgreSQL：推荐 PostgreSQL 16  
  下载：https://www.postgresql.org/download/windows/

- Node.js：推荐 Node.js 22 LTS 或更新的 LTS 版本  
  下载：https://nodejs.org/en/download

## PostgreSQL 初始化

安装 PostgreSQL 后，创建项目默认用户和数据库：

```sql
CREATE USER heysure WITH PASSWORD 'heysure';
CREATE DATABASE heysure OWNER heysure;
```

如果用户已存在，可以只重置密码：

```sql
ALTER USER heysure WITH PASSWORD 'heysure';
```

仓库根目录 `.env` 里默认连接串应为：

```env
DATABASE_URL=postgresql+psycopg://heysure:heysure@127.0.0.1:5432/heysure
```

## 启动器按钮

- `安装依赖`：安装后台 Python 依赖。
- `环境检查`：检查 Python、后台虚拟环境、PostgreSQL、Node.js、npm、前端依赖。
- `全部启动`：启动 gateway、mcp、connector、ai、web。
