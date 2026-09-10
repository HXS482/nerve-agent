"""
调用 SiliconFlow API（OpenAI 兼容协议）与大语言模型对话。
支持流式输出与多轮对话。语言：Python。

依赖：pip install openai
"""

import os
import sys

from openai import OpenAI

# ─── 配置 ───────────────────────────────────────────────
BASE_URL = "https://api.siliconflow.cn/v1"
MODEL = "Qwen/Qwen2.5-7B-Instruct"   # 可替换为其他模型
SYSTEM_PROMPT = (
    "你是一个冷静理智的对话者，说话充满辩证和逻辑思维，"
    "喜欢用哲学揭示现实的本质。回答简洁。"
)


def get_client() -> OpenAI:
    """从环境变量读取 API Key 并创建客户端。"""
    api_key = os.environ.get("SILICONFLOW_API_KEY")
    if not api_key:
        sys.exit("错误：请先设置环境变量 SILICONFLOW_API_KEY")
    return OpenAI(api_key=api_key, base_url=BASE_URL)


def chat(client: OpenAI, messages: list) -> str:
    """非流式调用：发送多轮消息，返回完整回复。"""
    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.7,
        max_tokens=512,
    )
    return resp.choices[0].message.content


def chat_stream(client: OpenAI, messages: list):
    """流式调用：逐段输出，实时打印。"""
    stream = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.7,
        stream=True,
    )
    print("助手：", end="", flush=True)
    full = ""
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            print(delta, end="", flush=True)
            full += delta
    print()
    return full


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    client = get_client()
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    print("多轮对话（输入 q 退出，s 切换流式输出）\n" + "─" * 50)

    stream_mode = False
    while True:
        try:
            user = input("你：").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user:
            continue
        if user.lower() == "q":
            break
        if user.lower() == "s":
            stream_mode = not stream_mode
            print(f"[流式输出：{'开' if stream_mode else '关'}]")
            continue

        messages.append({"role": "user", "content": user})
        try:
            if stream_mode:
                reply = chat_stream(client, messages)
            else:
                reply = chat(client, messages)
                print(f"助手：{reply}")
        except Exception as e:
            print(f"[调用失败：{e}]")
            messages.pop()      # 失败的轮次不进入历史
            continue

        messages.append({"role": "assistant", "content": reply})

    print("对话终止。所有轮次均已随会话消散——除非你曾保存它们。")


if __name__ == "__main__":
    main()
