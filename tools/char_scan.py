import os
import sys


def scan_characters(project_root):
    active_dir = os.path.join(project_root, "characters", "active")
    if not os.path.exists(active_dir):
        print("characters/active/ 目录不存在")
        return

    files = [
        f for f in os.listdir(active_dir)
        if f.endswith(".md") and os.path.isfile(os.path.join(active_dir, f))
    ]

    if not files:
        print("暂无活跃角色。")
        return

    print("=== 角色状态摘要 ===\n")
    for fname in files:
        fpath = os.path.join(active_dir, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()

        name = ""
        hp = "?"
        max_hp = "?"
        sp = "?"
        max_sp = "?"
        lv = "?"
        location = "?"
        status = ""

        for line in content.split("\n"):
            line = line.strip()
            if line.startswith("| 姓名") and "|" in line:
                parts = [p.strip() for p in line.split("|")]
                name = parts[2] if len(parts) > 2 else ""
            if "HP |" in line or "生命值 |" in line:
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 5:
                    hp = parts[3] if parts[3] else "?"
                    max_hp = parts[4] if parts[4] else "?"
            if "SP |" in line or "体力值 |" in line:
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 5:
                    sp = parts[3] if parts[3] else "?"
                    max_sp = parts[4] if parts[4] else "?"
            if "等级" in line and "|" in line:
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 3:
                    lv = parts[2] if parts[2] else "?"

        name = name or fname.replace(".md", "")
        print(f"角色：{name} | HP: {hp}/{max_hp} | SP: {sp}/{max_sp}")
        print(f"  等级：Lv{lv}\n")


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    scan_characters(project_root)


if __name__ == "__main__":
    main()
