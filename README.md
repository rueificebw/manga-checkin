# 自动签到

基于 Breeze 插件开发的 GitHub Actions 自动签到工具。

## 相关链接

- Breeze 漫画阅读器: https://github.com/deretame/Breeze
- [Breeze-plugin-JmComic](https://github.com/deretame/Breeze-plugin-JmComic) 
- [Breeze-plugin-bikaComic](https://github.com/deretame/Breeze-plugin-bikaComic) 

## 自动签到配置

1. Fork 本仓库
2. 进入仓库 **Settings** → **Secrets and variables** → **Actions**
3. 添加以下 Secrets：

   **禁漫天堂**
   - `JM_ACCOUNT`：禁漫天堂账号
   - `JM_PASSWORD`：禁漫天堂密码

   **哔咔漫画**
   - `BIKA_ACCOUNT`：哔咔漫画账号
   - `BIKA_PASSWORD`：哔咔漫画密码

4. 签到任务自动执行时间（北京时间）：
   - 禁漫天堂：每天 **07:00**
   - 哔咔漫画：每天 **06:00**
5. 也可以手动触发：进入 Actions 页面 → 选择对应工作流 → 点击 **Run workflow**
