import argparse
import random
import datetime
import os


def generate_pool(d20_count=50, d12_count=10, d10_count=15, d8_count=15, d6_count=20, d4_count=15):
    pools = {
        "d20": [random.randint(1, 20) for _ in range(d20_count)],
        "d12": [random.randint(1, 12) for _ in range(d12_count)],
        "d10": [random.randint(1, 10) for _ in range(d10_count)],
        "d8": [random.randint(1, 8) for _ in range(d8_count)],
        "d6": [random.randint(1, 6) for _ in range(d6_count)],
        "d4": [random.randint(1, 4) for _ in range(d4_count)],
    }
    return pools


def format_markdown(pools, large=False):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"# 骰池 — 生成于 {now}",
        "",
        "> AI DM 严格按行序消耗：从章节顶部向下取，用完一行立即删除该行。",
        "> 用完后请玩家重新运行 `python tools/dice_pool.py -o` 补充。",
        "> v4: D20引擎——所有检定使用d20。",
        "",
    ]
    for die, values in pools.items():
        lines.append(f"## {die}（{len(values)}个）")
        for v in values:
            lines.append(str(v))
        lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="骰池生成器 — v4 D20引擎")
    parser.add_argument("-o", "--output", action="store_true", help="写入 tools/dice_pool.md")
    parser.add_argument("-l", "--large", action="store_true", help="生成大骰池(2x数量)")
    parser.add_argument("--d20", type=int, default=50)
    parser.add_argument("--d12", type=int, default=10)
    parser.add_argument("--d10", type=int, default=15)
    parser.add_argument("--d8", type=int, default=15)
    parser.add_argument("--d6", type=int, default=20)
    parser.add_argument("--d4", type=int, default=15)

    args = parser.parse_args()

    mul = 2 if args.large else 1
    pools = generate_pool(
        d20_count=args.d20 * mul,
        d12_count=args.d12 * mul,
        d10_count=args.d10 * mul,
        d8_count=args.d8 * mul,
        d6_count=args.d6 * mul,
        d4_count=args.d4 * mul,
    )

    md = format_markdown(pools, large=args.large)

    if args.output:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        filepath = os.path.join(script_dir, "dice_pool.md")
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"骰池已写入: {filepath}")
        total = sum(len(v) for v in pools.values())
        print(f"总计生成 {total} 个骰子")
    else:
        print(md)


if __name__ == "__main__":
    main()
