# 使用 Git 托管代码与配置

> 适用场景：Apollo EDU PnC 赛道，管理 `modules/planning/` 源码和 `profiles/default/` 配置参数。

---

## 一、为什么要用 Git 管理

| 需求 | Git 能解决的问题 |
|------|-----------------|
| 改坏了想回退 | `git checkout` 一条命令恢复任意历史版本 |
| 多个场景方案对比 | 每个场景用一个 branch，随时切换 |
| 换电脑 / 换队友协作 | `git push` 到远端，`git clone` 拉回来 |
| 记录调优过程 | 每次调参后 commit，日志里清楚记录改了什么 |

---

## 二、初始化仓库

在 **宿主机**（不是容器内）的 `application-pnc` 根目录执行：

```bash
cd application-pnc

# 如果还没有 git 仓库，初始化
git init

# 配置用户信息（只需设置一次）
git config user.name  "你的名字"
git config user.email "你的邮箱"
```

### 配置 .gitignore

以下文件**不应**纳入版本控制（二进制、缓存、日志）：

```bash
cat >> .gitignore << 'EOF'
# Apollo 构建产物和缓存
.cache/
bazel-*
*.pyc
__pycache__/

# 日志和数据
data/log/
data/record/
*.log

# AEM 环境目录（镜像层，不需要托管）
.aem/

# 压缩包
*.tar.gz
*.zip

# 编辑器
.idea/
.vscode/
EOF
```

---

## 三、纳入管理的目录

只需要管理两个目录：

| 目录 | 内容 | 说明 |
|------|------|------|
| `modules/planning/` | 源码（用 `buildtool install` 下载来的） | 改了源码才有此目录 |
| `profiles/default/` | 配置参数 | 调参成果，**必须管理** |

```bash
# 首次提交
git add profiles/default/
git add modules/planning/    # 若已下载源码
git commit -m "初始版本：基础配置 + planning 源码"
```

---

## 四、日常提交工作流

每次调完参数或改完代码，在**宿主机**执行：

```bash
# 查看改动了哪些文件
git status
git diff profiles/default/

# 暂存改动
git add profiles/default/
git add modules/planning/    # 若有代码改动

# 提交（写清楚改了什么，方便回溯）
git commit -m "调整 crosswalk 减速距离：10m → 8m，通过人行道场景测试"
```

> **提交信息写法建议**：`[场景名] 改了什么参数 → 效果描述`
> - `[人行道] stop_distance 8.0→6.0，减少停车等待时间`
> - `[借道绕行] 新增 lane_borrow 插件，通过借道场景`

---

## 五、分支管理——为每个场景维护独立配置

使用 branch 隔离不同EDU 场景的配置，避免相互干扰：

### 分支规划建议

```
main            ← 主干，保存当前综合最优配置
├── scene/crosswalk      ← 人行道避让调优
├── scene/lane-borrow    ← 借道绕行调优
├── scene/intersection   ← 交汇路口减速慢行
├── scene/parking        ← 自主泊车
└── experiment/xxx       ← 实验性改动（不确定是否保留）
```

### 常用命令

```bash
# 查看所有分支
git branch -a

# 新建并切换到场景分支
git checkout -b scene/crosswalk

# 在此分支上修改配置、提交
git add profiles/default/
git commit -m "[人行道] 调整停车距离参数"

# 切回主干
git checkout main

# 把场景分支的成果合并到主干（确认有效后）
git merge scene/crosswalk

# 对比两个分支的配置差异
git diff main scene/crosswalk -- profiles/default/
```

### 快速切换场景方案

```bash
# 切换到借道绕行分支（配置自动还原为该分支的状态）
git checkout scene/lane-borrow

# 重新激活 profile（切换分支后需重新执行，使配置在 Apollo 内生效）
aem enter
aem profile use default
exit
```

> **注意**：每次切换分支后，都要执行 `aem profile use default` 使新配置生效，否则 Apollo 仍读取旧配置。

---

## 六、推送到远端（GitHub / Gitee）

### 6.1 创建远端仓库

在 GitHub 或 Gitee 创建一个**私有仓库**（建议私有，避免泄露EDU 方案）。

### 6.2 关联远端

```bash
# GitHub
git remote add origin https://github.com/你的用户名/apollo-pnc-contest.git

# 或 Gitee（国内访问更稳定）
git remote add origin https://gitee.com/你的用户名/apollo-pnc-contest.git
```

### 6.3 推送

```bash
# 首次推送主干
git push -u origin main

# 推送场景分支
git push origin scene/crosswalk
```

---

## 七、从远端恢复（换电脑 / 代码丢失）

```bash
# 克隆到新机器
git clone https://github.com/你的用户名/apollo-pnc-contest.git application-pnc
cd application-pnc

# 拉取所有分支
git fetch --all

# 切到需要的分支
git checkout scene/crosswalk

# 重装 Apollo 容器后，进入容器激活配置
aem start && aem enter
aem profile use default
```

若需要重新编译源码：

```bash
# 容器内
buildtool build -p modules/planning/
aem profile use default
```

---

## 八、常用命令速查

```bash
# 查看提交历史（带图形显示分支）
git log --oneline --graph --all

# 回退到某个历史提交（查看效果用，不修改历史）
git checkout <commit-hash> -- profiles/default/

# 撤销最近一次提交（保留文件改动）
git reset HEAD~1

# 强制回退到某个版本（⚠️ 会丢失此后的提交）
git reset --hard <commit-hash>

# 查看某次提交改了什么
git show <commit-hash>

# 暂存当前改动（临时切换分支时用）
git stash
git stash pop    # 恢复
```
