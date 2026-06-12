"""知识与进化工坊（server/workshop/）——服务端内置，免独立进程。

只改本目录即可控制知识与进化方向：
- ``direction.md``  方向指引（随工具结果实时注入给 AI，保存即生效）
- ``policy.py``     入参/结果钩子
- ``tools.py``      工具描述与 schema

接入与执行见 ``engine.py``；详细说明见 ``README.md``。
"""
