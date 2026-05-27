# MIMO API 调用监控仪表盘

## 功能特性

### 1. 实时监控面板
- **总调用次数**：实时统计API调用总量，显示增长趋势
- **成功率**：监控请求成功比例，及时发现异常
- **平均响应时间**：跟踪API响应延迟，优化性能
- **活跃模型**：显示当前使用的模型数量及高性能模型占比

### 2. 数据可视化
- **调用趋势图**：24小时调用次数变化曲线
- **模型分布图**：各模型调用占比饼图（mimo-7b/13b/33b）
- **交互式图表**：支持悬停查看详细数据

### 3. MIMO大模型接入指南
- **计费方式**：输入/输出Token定价说明
- **接入示例**：Python代码示例，使用OpenAI兼容接口
- **费用计算器**：实时计算调用成本

### 4. 实时活动日志
- 最新API调用记录
- 包含时间、模型、状态、延迟、Token使用和费用信息

## 快速开始

### 方法1：直接打开
双击 `api-monitor-dashboard.html` 文件，即可在浏览器中查看。

### 方法2：本地服务器
```bash
# 使用Python
python -m http.server 8000

# 使用Node.js
npx serve .

# 使用PHP
php -S localhost:8000
```

然后访问 `http://localhost:8000/api-monitor-dashboard.html`

## 集成到现有系统

### 1. 替换示例数据
在 `initActivityLog()` 函数中，替换 `activities` 数组为真实数据：

```javascript
const activities = [
    { time: '14:32:15', model: 'mimo-7b', status: 'success', latency: '180ms', tokens: '1,247', cost: '¥0.0049' },
    // 添加更多记录...
];
```

### 2. 实时数据更新
修改 `updateDashboard()` 函数，连接实际的API端点：

```javascript
async function fetchRealData() {
    const response = await fetch('/api/monitor/stats');
    const data = await response.json();
    
    document.getElementById('totalCalls').textContent = data.totalCalls.toLocaleString();
    document.getElementById('successRate').textContent = data.successRate + '%';
    document.getElementById('avgResponse').textContent = data.avgResponse + 'ms';
}
```

### 3. WebSocket实时推送
```javascript
const ws = new WebSocket('wss://your-api.com/monitor');
ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    updateDashboard(data);
};
```

## MIMO API接入配置

### 基础配置
```python
import openai

client = openai.OpenAI(
    api_key="your-api-key",
    base_url="https://api.mimo.ai/v1"
)
```

### 可用模型
- `mimo-7b`：轻量级模型，适合简单任务
- `mimo-13b`：平衡性能与成本
- `mimo-33b`：高性能模型，适合复杂推理

### 计费说明
| 类型 | 价格 |
|------|------|
| 输入Token | ¥0.002 / 1K tokens |
| 输出Token | ¥0.006 / 1K tokens |
| 并发限制 | 1000 RPM |

### 费用计算公式
```
单次费用 = (输入Token数 × 0.002 + 输出Token数 × 0.006) / 1000
总费用 = 单次费用 × 调用次数
```

## 自定义配置

### 修改主题颜色
在CSS变量中修改颜色：
```css
:root {
    --accent-blue: #3b82f6;    /* 主色调 */
    --accent-purple: #8b5cf6;  /* 辅助色 */
    --accent-emerald: #10b981; /* 成功色 */
    --accent-amber: #f59e0b;   /* 警告色 */
}
```

### 添加新指标
在 `Stats Grid` 部分添加新的统计卡片：
```html
<div class="double-bezel stat-card">
    <div class="double-bezel-inner">
        <div class="flex items-start justify-between mb-4">
            <div class="p-2 rounded-lg bg-[颜色]/10">
                <!-- 图标 -->
            </div>
        </div>
        <div class="text-3xl font-bold mb-1" id="newMetric">0</div>
        <div class="text-sm text-gray-400">新指标</div>
    </div>
</div>
```

## 浏览器兼容性
- Chrome 80+
- Firefox 78+
- Safari 14+
- Edge 80+

## 性能优化
- 使用CDN加载Chart.js和Tailwind CSS
- 图表数据懒加载
- 响应式设计，适配移动端
- 自动刷新间隔30秒

## 故障排除

### 图表不显示
1. 检查网络连接，确保CDN资源可访问
2. 打开浏览器开发者工具查看错误信息
3. 确认Chart.js库已正确加载

### 样式异常
1. 清除浏览器缓存
2. 检查CSS变量是否正确定义
3. 确认Tailwind CSS已加载

### 数据不更新
1. 检查定时器是否正常运行
2. 确认数据源API可访问
3. 查看控制台是否有JavaScript错误

## 技术栈
- HTML5 + CSS3 + JavaScript
- Tailwind CSS (通过CDN)
- Chart.js 3.x (通过CDN)
- Google Fonts (Inter + JetBrains Mono)

## 许可证
MIT License - 可自由使用和修改