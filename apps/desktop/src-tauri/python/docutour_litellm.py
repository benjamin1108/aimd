import json
import os
import re
import sys

try:
    from litellm import completion
except Exception as exc:
    print(json.dumps({"error": f"LiteLLM 未安装或不可用: {exc}"}))
    sys.exit(0)


def extract_json(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


payload = json.load(sys.stdin)
config = payload["config"]
provider = config.get("provider", "dashscope")
api_key = config.get("apiKey", "")
api_base = config.get("apiBase") or None

if provider == "dashscope":
    os.environ["DASHSCOPE_API_KEY"] = api_key
elif provider == "gemini":
    os.environ["GEMINI_API_KEY"] = api_key

anchors = payload.get("anchors", [])
max_steps = int(config.get("maxSteps") or 6)
language = config.get("language") or "zh-CN"

system = (
    "You generate concise Docu-Tour scripts for complex Markdown documents. "
    "Return only valid JSON. Never invent target ids. Narration should explain "
    "the business value or reader takeaway of the highlighted element."
)

user = {
    "instruction": (
        f"Select 3 to {max_steps} important anchors and create a guided reading script. "
        f"Use language {language}. Return schema: "
        '{"version":1,"title":"...","steps":[{"targetId":"anchor id","narration":"2-3 short sentences"}]}.'
    ),
    "anchors": anchors,
    "markdown": payload.get("markdown", "")[:40000],
}

kwargs = {
    "model": config["model"],
    "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ],
    "temperature": 0.2,
}
if api_base:
    kwargs["api_base"] = api_base

try:
    response = completion(**kwargs)
    content = response.choices[0].message.content
    print(json.dumps(extract_json(content), ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"error": f"导览生成失败: {exc}"}, ensure_ascii=False))
