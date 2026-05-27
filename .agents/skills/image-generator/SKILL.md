---
name: image-generator
description: Generate images using AI models via SiliconFlow API. Use when user wants to create images from text descriptions.
triggers:
  - "生成图片"
  - "画一张图"
  - "AI生图"
  - "帮我画"
---

# Image Generator

使用硅基流动API生成图片。

## 配置

- API Key: `$env:SILICONFLOW_API_KEY` 或 `process.env.SILICONFLOW_API_KEY`
- Base URL: `https://api.siliconflow.cn/v1`

## 使用方式

### 方式1：手动命令（快速简单）

```powershell
$headers = @{
    Authorization = "Bearer $env:SILICONFLOW_API_KEY"
    "Content-Type" = "application/json"
}
$body = @{model="Kwai-Kolors/Kolors";prompt="描述";negative_prompt="blurry";image_size="1024x1024";num_inference_steps=25;guidance_scale=7.5} | ConvertTo-Json -Compress
$url = (Invoke-RestMethod -Uri "https://api.siliconflow.cn/v1/images/generations" -Method Post -Headers $headers -Body $body).data[0].url
$galleryDir = "$env:USERPROFILE\.nerve\images"
if (!(Test-Path $galleryDir)) { New-Item -ItemType Directory -Path $galleryDir -Force | Out-Null }
Invoke-WebRequest -Uri $url -OutFile "$galleryDir\image.png"
```

### 方式2：使用模板（推荐）

脚本位置：`G:\worktree\nerve-agent\.agents\skills\image-generator\generate.ps1`

支持参数传入（直接运行）：

```powershell
. "G:\worktree\nerve-agent\.agents\skills\image-generator\generate.ps1" -prompt "cute shiba inu" -filename "shiba"
```

或修改脚本内默认参数后直接运行。

## Prompt 技巧（重要！）

- **优先使用英文 prompt**，中文 prompt 容易偏离主题
- 主体描述要具体：`Pembroke Welsh Corgi puppy` > `柯基` > `小狗`
- 加入风格关键词：`photorealistic`, `4k`, `high detail`, `shallow depth of field`
- 加入场景细节：`dappled golden sunlight`, `forest trail`, `fallen leaves`
- negative_prompt 保持：`blurry, bad anatomy, deformed, extra limbs, low quality, watermark, text`

## 交互流程

用 question 工具询问（快速确认，不需要全问）：

1. 图片内容（主体）
2. 细节（品种、毛色、表情）
3. 风格（插画/照片/动漫/卡通）

> 如果用户描述足够具体，直接生成，不用问。

## 可用模型

| Model ID           | Description                 | 状态      |
| ------------------ | --------------------------- | --------- |
| Kwai-Kolors/Kolors | 快手可图 Kolors（唯一可用） | ✅ 可用   |
| FLUX1-dev          | 高质量 FLUX                 | ❌ 不存在 |
| FLUX1-schnell      | 快速生成                    | ❌ 已禁用 |

> ⚠️ FLUX 模型当前不可用，不要尝试。只有 Kolors。

## 注意事项

- 需要 `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` 才能下载图片
- 下载偶发失败，脚本已内置 3 次重试
- 图片保存到内置 Gallery（`~/.nerve/images/`），文件名带时间戳避免覆盖
- **重要：生成完成后，在回复中包含图片的完整文件路径**（如 `C:\Users\Arch\.nerve\images\puppy_20260511.png`），聊天界面会自动检测并内联显示图片

## 尺寸

1024x1024, 960x1280, 768x1024, 720x1280
