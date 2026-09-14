import React from "react";
import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";

// ============================================================
// DeepSeek Harness 保姆级教程 · 科技新闻风动效组件包
// 画布：1920×1080（视频置于左上角，信息面板在右侧，字幕在底部）
// 全部动效由 Remotion 帧驱动；台词时间轴来自逐句转写时间戳。
// ============================================================

export const FPS = 25;
export const DURATION_IN_FRAMES = 3915;

const FONT = '"Microsoft YaHei", "PingFang SC", Inter, sans-serif';

type CommonProps = {
  backgroundOpacity?: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function parseStarts(starts: string): number[] {
  return starts
    .split("|")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

// ------------------------------------------------------------
// 1. TitleReveal — 片头标题（故障/打字机揭示）
// ------------------------------------------------------------
type TitleRevealProps = CommonProps & {
  kicker?: string;
  line1?: string;
  line2?: string;
  sub?: string;
  accentColor?: string;
};

export const TitleReveal: React.FC<TitleRevealProps> = ({
  kicker = "BREAKING · AI TOOLS",
  line1 = "DeepSeek Harness",
  line2 = "保姆级教程",
  sub = "三分钟讲透：从安装到插件玩法",
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 15, stiffness: 110}});
  const blur = interpolate(frame, [0, 10], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glitch = frame < 9 ? Math.sin(frame * 2.9) * 4 * (1 - frame / 9) : 0;
  const dotPulse = frame % 20 < 10 ? 1 : 0.35;
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 880,
        height: 260,
        boxSizing: "border-box",
        padding: "26px 34px",
        borderRadius: 24,
        background: `rgba(7, 16, 28, ${0.82 * alpha})`,
        border: `1px solid ${accentColor}${Math.round(40 * alpha)
          .toString(16)
          .padStart(2, "0")}`,
        boxShadow: `0 26px 80px rgba(0,0,0,${0.4 * alpha})`,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 30}px) translateX(${glitch}px)`,
        filter: `blur(${blur}px)`,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "0.22em",
          color: "#fbbf24",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            borderRadius: 999,
            background: "#f87171",
            marginRight: 12,
            opacity: dotPulse,
            boxShadow: "0 0 12px #f87171",
          }}
        />
        {kicker}
      </div>
      <div
        style={{
          marginTop: 18,
          fontSize: 56,
          fontWeight: 800,
          color: "#ffffff",
          textShadow: `0 0 26px ${accentColor}66, 0 4px 18px rgba(0,0,0,.6)`,
        }}
      >
        {line1}
      </div>
      <div
        style={{
          fontSize: 76,
          fontWeight: 900,
          lineHeight: 1.05,
          color: "#ffffff",
          textShadow: `0 0 30px ${accentColor}88, 0 4px 18px rgba(0,0,0,.6)`,
        }}
      >
        {line2}
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 30,
          color: "rgba(220,240,255,0.85)",
        }}
      >
        {sub}
      </div>
    </div>
  );
};

// ------------------------------------------------------------
// 2. KeywordBurst — 关键词爆发
// ------------------------------------------------------------
type KeywordBurstProps = CommonProps & {
  word?: string;
  word2?: string;
  sub?: string;
  accentColor?: string;
};

export const KeywordBurst: React.FC<KeywordBurstProps> = ({
  word = "关键词",
  word2 = "",
  sub = "",
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 13, stiffness: 160}});
  const ring = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 880,
        height: 220,
        boxSizing: "border-box",
        padding: "30px 36px",
        borderRadius: 24,
        background: `rgba(7, 16, 28, ${0.78 * alpha})`,
        boxShadow: `0 24px 70px rgba(0,0,0,${0.36 * alpha})`,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 880,
          height: 220,
          borderRadius: 24,
          border: `2px solid ${accentColor}`,
          opacity: 0.5 * (1 - ring),
          transform: `scale(${0.96 + ring * 0.08})`,
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          fontSize: 60,
          fontWeight: 900,
          color: "#ffffff",
          transform: `scale(${0.82 + enter * 0.18})`,
          transformOrigin: "left center",
          textShadow: `0 0 30px ${accentColor}88, 0 4px 16px rgba(0,0,0,.6)`,
        }}
      >
        {word}
      </div>
      {word2 ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 40,
            fontWeight: 800,
            color: accentColor,
            opacity: enter,
          }}
        >
          {word2}
        </div>
      ) : null}
      {sub ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 22,
            letterSpacing: "0.14em",
            color: "rgba(210,230,248,0.75)",
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};

// ------------------------------------------------------------
// 3. Leaderboard — 排行与名次变化（GPT 5.2 编码能力 30→5）
// ------------------------------------------------------------
type LeaderboardProps = CommonProps & {
  kicker?: string;
  title?: string;
  labelA?: string;
  valueA?: number;
  labelB?: string;
  valueB?: number;
  unit?: string;
  gainText?: string;
  accentColor?: string;
};

export const Leaderboard: React.FC<LeaderboardProps> = ({
  kicker = "LAB TEST",
  title = "编码能力排名",
  labelA = "优化前",
  valueA = 30,
  labelB = "优化后",
  valueB = 5,
  unit = "名",
  gainText = "排名提升 25 位",
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const grow = interpolate(frame, [8, 44], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const numA = valueA;
  const numB = Math.round(interpolate(frame, [110, 165], [valueA, valueB], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const gain = valueA - valueB;
  const barB = interpolate(
    frame,
    [110, 165],
    [100, (valueB / Math.max(1, valueA)) * 100],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );
  const badgeIn = spring({
    frame: Math.max(0, frame - 165),
    fps,
    config: {damping: 14, stiffness: 140},
  });
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1080,
        height: 320,
        boxSizing: "border-box",
        padding: "28px 36px",
        borderRadius: 24,
        background: `rgba(7, 16, 28, ${0.82 * alpha})`,
        border: `1px solid ${accentColor}55`,
        boxShadow: `0 26px 80px rgba(0,0,0,${0.4 * alpha})`,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: "0.2em",
            color: accentColor,
          }}
        >
          {kicker}
        </span>
        <span
          style={{
            fontSize: 22,
            color: "rgba(210,230,248,0.8)",
          }}
        >
          {title}
        </span>
      </div>
      {[
        {
          label: labelA,
          num: numA,
          pct: 100,
          color: "#f87171",
          glow: "#f87171",
        },
        {
          label: labelB,
          num: numB,
          pct: barB,
          color: accentColor,
          glow: accentColor,
        },
      ].map((row) => (
        <div key={row.label} style={{marginTop: 22}}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 24,
              color: "rgba(220,240,255,0.85)",
            }}
          >
            <span>{row.label}</span>
            <span style={{color: row.color, fontWeight: 900, fontSize: 40, lineHeight: 1}}>
              {row.num}
              <span style={{fontSize: 20, marginLeft: 6, fontWeight: 700}}>{unit}</span>
            </span>
          </div>
          <div
            style={{
              marginTop: 10,
              height: 12,
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${row.pct * grow}%`,
                height: "100%",
                borderRadius: 999,
                background: row.color,
                boxShadow: `0 0 16px ${row.glow}88`,
              }}
            />
          </div>
        </div>
      ))}
      <div
        style={{
          marginTop: 18,
          display: "inline-block",
          fontSize: 24,
          fontWeight: 800,
          color: "#4ade80",
          background: "rgba(74,222,128,0.12)",
          padding: "6px 18px",
          borderRadius: 999,
          border: "1px solid rgba(74,222,128,0.4)",
          opacity: badgeIn,
          transform: `translateY(${(1 - badgeIn) * 12}px)`,
        }}
      >
        ▲ {gainText.replace("25", String(gain))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------
// 4. Checklist — 安装三步检查清单（逐条按台词弹出）
// ------------------------------------------------------------
type ChecklistProps = CommonProps & {
  kicker?: string;
  i1?: string;
  s1?: string;
  i2?: string;
  s2?: string;
  i3?: string;
  s3?: string;
  i4?: string;
  s4?: string;
  itemStarts?: string;
  accentColor?: string;
};

export const Checklist: React.FC<ChecklistProps> = ({
  kicker = "安装 · 只要三步",
  i1 = "第一步",
  s1 = "",
  i2 = "第二步",
  s2 = "",
  i3 = "第三步",
  s3 = "",
  i4 = "",
  s4 = "",
  itemStarts = "0|1.2|2.4|3.6",
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const starts = parseStarts(itemStarts);
  const items = [
    {t: i1, s: s1},
    {t: i2, s: s2},
    {t: i3, s: s3},
    {t: i4, s: s4},
  ].filter((it) => it.t !== "");
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1080,
        height: 620,
        boxSizing: "border-box",
        padding: "28px 36px",
        borderRadius: 24,
        background: `rgba(7, 16, 28, ${0.82 * alpha})`,
        border: `1px solid ${accentColor}55`,
        boxShadow: `0 26px 80px rgba(0,0,0,${0.4 * alpha})`,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "0.2em",
          color: "#4ade80",
        }}
      >
        {kicker}
      </div>
      {items.map((item, idx) => {
        const st = starts[idx] ?? 0;
        const visible = t >= st;
        const itemFrame = Math.max(0, frame - Math.round(st * fps));
        const slide = interpolate(itemFrame, [0, 12], [34, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const check = interpolate(itemFrame, [4, 16], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={item.t}
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: idx === 0 ? 20 : 16,
              opacity: visible ? 1 : 0,
              transform: `translateX(${visible ? slide : 34}px)`,
            }}
          >
            <svg width="44" height="44" viewBox="0 0 44 44">
              <circle
                cx="22"
                cy="22"
                r="20"
                fill="none"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth="3"
              />
              <circle
                cx="22"
                cy="22"
                r="20"
                fill="none"
                stroke="#4ade80"
                strokeWidth="3"
                strokeDasharray="126"
                strokeDashoffset={126 * (1 - check)}
                transform="rotate(-90 22 22)"
              />
              <path
                d="M 13 23 L 19.5 29.5 L 31.5 15.5"
                fill="none"
                stroke="#4ade80"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - check}
              />
            </svg>
            <div style={{marginLeft: 18, minWidth: 0}}>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: "#ffffff",
                }}
              >
                {item.t}
              </div>
              {item.s ? (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 25,
                    color: "rgba(200,225,248,0.78)",
                    fontFamily: '"Consolas", "Microsoft YaHei", monospace',
                  }}
                >
                  {item.s}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------
// 5. StatGrid — 2×2 信息矩阵（四种模式 / 社区插件）
// ------------------------------------------------------------
type StatGridProps = CommonProps & {
  kicker?: string;
  i1?: string;
  d1?: string;
  i2?: string;
  d2?: string;
  i3?: string;
  d3?: string;
  i4?: string;
  d4?: string;
  itemStarts?: string;
  accentColor?: string;
};

export const StatGrid: React.FC<StatGridProps> = ({
  kicker = "四种模式",
  i1 = "标准模式",
  d1 = "日常干活",
  i2 = "PTC 模式",
  d2 = "批量任务",
  i3 = "极简模式",
  d3 = "开发者测试",
  i4 = "创造模式",
  d4 = "DIY 插件",
  itemStarts = "0|1.5|5.5|11.5",
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const starts = parseStarts(itemStarts);
  const cells = [
    {t: i1, d: d1, c: accentColor},
    {t: i2, d: d2, c: "#8b5cf6"},
    {t: i3, d: d3, c: "#fbbf24"},
    {t: i4, d: d4, c: "#4ade80"},
  ];
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1080,
        height: 640,
        boxSizing: "border-box",
        padding: "26px 34px",
        borderRadius: 24,
        background: `rgba(7, 16, 28, ${0.8 * alpha})`,
        border: `1px solid ${accentColor}55`,
        boxShadow: `0 26px 80px rgba(0,0,0,${0.4 * alpha})`,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "0.2em",
          color: accentColor,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginTop: 22,
        }}
      >
        {cells.map((cell, idx) => {
          const st = starts[idx] ?? 0;
          const visible = t >= st;
          const itemFrame = Math.max(0, frame - Math.round(st * fps));
          const pop = spring({
            frame: itemFrame,
            fps,
            config: {damping: 13, stiffness: 150},
          });
          return (
            <div
              key={cell.t}
              style={{
                height: 238,
                boxSizing: "border-box",
                borderRadius: 18,
                padding: "22px 26px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                opacity: visible ? pop : 0,
                transform: `scale(${visible ? 0.86 + pop * 0.14 : 0.86})`,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: cell.c,
                  boxShadow: `0 0 12px ${cell.c}`,
                  marginRight: 12,
                }}
              />
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: "#ffffff",
                  marginTop: 12,
                }}
              >
                {cell.t}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 25,
                  color: "rgba(210,230,248,0.8)",
                }}
              >
                {cell.d}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ------------------------------------------------------------
// 6. BulletStack — 逐条要点（按台词逐条弹出）
// ------------------------------------------------------------
type BulletStackProps = CommonProps & {
  kicker?: string;
  i1?: string;
  s1?: string;
  i2?: string;
  s2?: string;
  i3?: string;
  s3?: string;
  i4?: string;
  s4?: string;
  itemStarts?: string;
  accentColor?: string;
};

export const BulletStack: React.FC<BulletStackProps> = ({
  kicker = "要点",
  i1 = "要点一",
  s1 = "",
  i2 = "要点二",
  s2 = "",
  i3 = "",
  s3 = "",
  i4 = "",
  s4 = "",
  itemStarts = "0|1.2|2.4|3.6",
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const starts = parseStarts(itemStarts);
  const items = [
    {t: i1, s: s1},
    {t: i2, s: s2},
    {t: i3, s: s3},
    {t: i4, s: s4},
  ].filter((it) => it.t !== "");
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1080,
        height: 600,
        boxSizing: "border-box",
        padding: "28px 38px",
        borderRadius: 24,
        background: `rgba(7, 16, 28, ${0.8 * alpha})`,
        border: `1px solid ${accentColor}55`,
        boxShadow: `0 26px 80px rgba(0,0,0,${0.4 * alpha})`,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "0.2em",
          color: accentColor,
        }}
      >
        {kicker}
      </div>
      {items.map((item, idx) => {
        const st = starts[idx] ?? 0;
        const visible = t >= st;
        const itemFrame = Math.max(0, frame - Math.round(st * fps));
        const slide = interpolate(itemFrame, [0, 14], [40, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={item.t}
            style={{
              display: "flex",
              alignItems: "baseline",
              marginTop: idx === 0 ? 22 : 18,
              opacity: visible ? 1 : 0,
              transform: `translateX(${visible ? slide : 40}px)`,
            }}
          >
            <span
              style={{
                color: accentColor,
                fontSize: 34,
                fontWeight: 900,
                marginRight: 16,
                textShadow: `0 0 14px ${accentColor}`,
              }}
            >
              ▸
            </span>
            <div style={{minWidth: 0}}>
              <div style={{fontSize: 34, fontWeight: 800, color: "#ffffff"}}>
                {item.t}
              </div>
              {item.s ? (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 26,
                    color: "rgba(205,228,250,0.78)",
                  }}
                >
                  {item.s}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------
// 7. CaptionHighlight — 底部卡拉OK式字幕（时间轴内置为源码常量）
// ------------------------------------------------------------
const CAPTIONS: {text: string; start: number; end: number}[] = [
  {text: "大家好！今天用三分钟，把 DeepSeek Harness 一次讲透。", start: 0.06, end: 4.68},
  {text: "先记住一个公式：AI Agent，等于大模型加 Harness。", start: 4.68, end: 9.18},
  {text: "大模型像一匹跑得很快的野马，Harness 就是缰绳和马鞭，这一整套驾驭系统。", start: 9.18, end: 14.22},
  {text: "装上它之后，就能驯服这匹野马，让它干起活来不跑偏。", start: 14.22, end: 18.48},
  {text: "同样的大模型，装上不同的 Harness，能力天差地别。", start: 18.48, end: 21.24},
  {text: "LangChain 做过一个实验，同一个 GPT 5.2，只是优化了 Harness，编码能力就从第三十名左右，冲到了第五名。", start: 21.24, end: 28.8},
  {text: "而 DeepSeek Harness 更特别：它不仅给你一匹训练好的马，还把整个跑马场开放给你，让你可以训练属于自己的 AI Agent。", start: 28.8, end: 38.34},
  {text: "安装只要三步。", start: 38.34, end: 39.72},
  {text: "第一步，去官网装好 Node.js，一路下一步就行。", start: 39.72, end: 43.56},
  {text: "第二步，打开命令行，Windows 用户按 Win 加 R 输入 cmd，Mac 用户按 Command 加空格输入终端，然后输入 npx @deepseek-ai/dsh web，回车后会得到一个网址，用浏览器打开就能用。", start: 43.56, end: 60.48},
  {text: "如果你已经有 Codex 这类 Agent 工具，那就更简单了，直接把仓库地址发给它，让它帮你装。", start: 60.3, end: 67.56},
  {text: "第三步，也可以下载桌面客户端，装好之后在弹窗里填上 API Key，就安装成功了。", start: 68.91, end: 70.26},
  {text: "进去之后有四种模式：标准模式，日常干活，体验和其他 Agent 产品差不多；PTC 模式，是标准模式的增强版，适合批量处理多步骤任务，比如一次分析一堆文件；极简模式，几乎裸跑大模型，适合开发者测试，普通用户一般用不上；最有意思的是创造模式，可以像搭积木一样拼接插件，DIY 自己的 Agent。", start: 70.26, end: 93.66},
  {text: "它的核心是 Cordis 插件内核，一句话概括：一切皆插件。", start: 93.66, end: 97.92},
  {text: "最厉害的是两个可组合性：时间上，插件卸载后影响彻底撤销，历史数据完整保留；空间上，插件之间可以互相依赖，一个能力暂时消失，依赖它的插件自动暂停，恢复之后又自动重启。", start: 98.58, end: 112.44},
  {text: "比如做个记账本，缺看图能力就接视觉插件，缺记账功能就补记账插件，一块块拼进同一个 Agent 里。", start: 112.44, end: 120.0},
  {text: "它还把每次会话记成一份事件日志，出了问题顺着轨迹往回翻，很快就能定位。", start: 120.0, end: 125.76},
  {text: "实战玩法也很多：可以装别人现成的换肤插件，一键切换主题；可以一句话生成一节完整的课程，PPT 课件、旁白、交互组件、随堂测验全都自动配好；哪怕不懂代码，也能让 Harness 自己手搓一个生图插件。", start: 125.76, end: 140.82},
  {text: "现在社区已经有几百个现成插件，换肤的、看余额的、备份数据的、补记忆的，应有尽有，大部分需求直接装现成的就行。", start: 140.82, end: 148.98},
  {text: "它也许还没有那么开箱即用，但它的上限，取决于整个开源社区的创造力。", start: 148.98, end: 154.2},
  {text: "关注我们，一起探索 AI 的更多玩法。", start: 154.2, end: 156.71},
];

function wrapText(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    if (current.length >= perLine) {
      const punct = Math.max(current.lastIndexOf("，"), current.lastIndexOf("、"));
      if (punct > perLine * 0.5) {
        lines.push(current.slice(0, punct + 1));
        current = current.slice(punct + 1) + ch;
        continue;
      }
      lines.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

type CaptionHighlightProps = CommonProps & {
  fontSize?: number;
  accentColor?: string;
};

export const CaptionHighlight: React.FC<CaptionHighlightProps> = ({
  fontSize = 36,
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const cap = CAPTIONS.find((c) => t >= c.start && t < c.end);
  const alpha = clamp01(backgroundOpacity);
  if (!cap) return <div style={{width: 1920, height: 120}} />;

  const lines = wrapText(cap.text, 44);
  const progress = clamp01((t - cap.start) / Math.max(0.001, cap.end - cap.start));
  const totalChars = lines.reduce((n, l) => n + l.length, 0);
  let global = 0;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1920,
        height: 120,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `rgba(5, 8, 14, ${0.35 * alpha})`,
        fontFamily: FONT,
      }}
    >
      {lines.map((line, li) => {
        const lineChars = line.split("");
        const elems = lineChars.map((ch, ci) => {
          const idx = global + ci;
          const hit = idx / totalChars < progress;
          return (
            <span
              key={`${li}-${ci}`}
              style={{
                color: hit ? accentColor : "rgba(255,255,255,0.96)",
                fontWeight: 800,
                textShadow: hit
                  ? `0 0 16px ${accentColor}, 0 3px 8px rgba(0,0,0,.9)`
                  : "0 3px 8px rgba(0,0,0,.9)",
                transform: hit ? "translateY(-2px)" : "none",
                display: "inline-block",
              }}
            >
              {ch === " " ? "\u00A0" : ch}
            </span>
          );
        });
        global += line.length;
        return (
          <div
            key={li}
            style={{
              fontSize,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
            }}
          >
            {elems}
          </div>
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------
// 8. ChapterMarker — 顶部章节进度条
// ------------------------------------------------------------
type ChapterMarkerProps = CommonProps & {
  accentColor?: string;
};

export const ChapterMarker: React.FC<ChapterMarkerProps> = ({
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const pct = interpolate(frame, [0, DURATION_IN_FRAMES], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shine = (frame * 4) % 2040;
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1920,
        height: 10,
        background: `rgba(255,255,255,${0.08 + 0.08 * alpha})`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${accentColor}, #8b5cf6)`,
          boxShadow: `0 0 14px ${accentColor}aa`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: shine - 120,
          width: 120,
          height: 10,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
        }}
      />
    </div>
  );
};

// ------------------------------------------------------------
// 9. StatusMonitor — 右上角 LIVE 状态徽标
// ------------------------------------------------------------
type StatusMonitorProps = CommonProps & {
  label?: string;
  dotColor?: string;
};

export const StatusMonitor: React.FC<StatusMonitorProps> = ({
  label = "LIVE · 保姆级教程",
  dotColor = "#f87171",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 16, stiffness: 130}});
  const blink = frame % 25 < 13 ? 1 : 0.25;
  const ring = (frame % 40) / 40;
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 240,
        height: 64,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        padding: "0 22px",
        background: `rgba(7, 16, 28, ${0.78 * alpha})`,
        border: "1px solid rgba(255,255,255,0.14)",
        opacity: enter,
        transform: `translateY(${(1 - enter) * -18}px)`,
        fontFamily: FONT,
      }}
    >
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: 14,
          height: 14,
          marginRight: 12,
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: 999,
            border: `2px solid ${dotColor}`,
            opacity: 0.6 * (1 - ring),
            transform: `scale(${0.6 + ring * 0.9})`,
          }}
        />
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            background: dotColor,
            opacity: blink,
            boxShadow: `0 0 12px ${dotColor}`,
          }}
        />
      </span>
      <span
        style={{
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: "0.08em",
          color: "#ffffff",
        }}
      >
        {label}
      </span>
    </div>
  );
};

// ------------------------------------------------------------
// 10. EndLockup — 结尾二维码关注卡
// ------------------------------------------------------------
const QR_URI = '';

type EndLockupProps = CommonProps & {
  title?: string;
  subtitle?: string;
  accentColor?: string;
};

export const EndLockup: React.FC<EndLockupProps> = ({
  title = "感谢观看",
  subtitle = "",
  accentColor = "#67e8f9",
  backgroundOpacity = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 15, stiffness: 110}});
  const glow = 0.5 + 0.5 * Math.sin(frame / 12);
  const alpha = clamp01(backgroundOpacity);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1080,
        height: 740,
        boxSizing: "border-box",
        borderRadius: 28,
        background: `rgba(7, 16, 28, ${0.86 * alpha})`,
        border: `1px solid ${accentColor}66`,
        boxShadow: `0 30px 90px rgba(0,0,0,${0.5 * alpha})`,
        opacity: enter,
        transform: `scale(${0.9 + enter * 0.1})`,
        fontFamily: FONT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 70,
      }}
    >
      <div
        style={{
          display: QR_URI ? 'block' : 'none',
          width: 320,
          height: 320,
          borderRadius: 24,
          padding: 14,
          background: "#ffffff",
          boxShadow: `0 0 ${26 + glow * 18}px ${accentColor}66`,
          boxSizing: "border-box",
        }}
      >
        <img
          src={QR_URI || undefined}
          alt="QR"
          style={{width: "100%", height: "100%", borderRadius: 12}}
        />
      </div>
      <div
        style={{
          marginTop: 46,
          width: 120,
          height: 6,
          borderRadius: 999,
          background: accentColor,
          boxShadow: `0 0 16px ${accentColor}`,
        }}
      />
      <div
        style={{
          marginTop: 30,
          fontSize: 50,
          fontWeight: 900,
          color: "#ffffff",
          textAlign: "center",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 20,
          fontSize: 30,
          color: "rgba(210,230,248,0.85)",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
};

// ============================================================
// 清单
// ============================================================
export const MOTION_COMPONENTS = [
  {
    id: "TitleReveal",
    name: "片头标题揭示",
    description: "故障感滑入的章节标题",
    category: "text",
    glyph: "T",
    component: TitleReveal,
    durationInFrames: 125,
    bounds: {x: 0, y: 0, width: 880, height: 260},
    defaultPosition: {x: 840, y: 110, scale: 1},
    defaultProps: {
      kicker: "BREAKING · AI TOOLS",
      line1: "DeepSeek Harness",
      line2: "保姆级教程",
      sub: "三分钟讲透：从安装到插件玩法",
      accentColor: "#67e8f9",
    },
    propsSchema: {
      kicker: {type: "text", label: "角标"},
      line1: {type: "text", label: "标题第一行"},
      line2: {type: "text", label: "标题第二行"},
      sub: {type: "text", label: "副标题"},
      accentColor: {type: "color", label: "强调色"},
    },
  },
  {
    id: "KeywordBurst",
    name: "关键词爆发",
    description: "关键词弹出与扩散光环",
    category: "text",
    glyph: "KW",
    component: KeywordBurst,
    durationInFrames: 115,
    bounds: {x: 0, y: 0, width: 880, height: 220},
    defaultPosition: {x: 840, y: 420, scale: 1},
    defaultProps: {
      word: "关键词",
      word2: "",
      sub: "",
      accentColor: "#67e8f9",
    },
    propsSchema: {
      word: {type: "text", label: "关键词"},
      word2: {type: "text", label: "次级词"},
      sub: {type: "text", label: "说明"},
      accentColor: {type: "color", label: "强调色"},
    },
  },
  {
    id: "Leaderboard",
    name: "排行名次变化",
    description: "排名对比与提升幅度",
    category: "chart",
    glyph: "RANK",
    component: Leaderboard,
    durationInFrames: 226,
    bounds: {x: 0, y: 0, width: 1080, height: 320},
    defaultPosition: {x: 840, y: 380, scale: 1},
    defaultProps: {
      kicker: "LAB TEST",
      title: "编码能力排名",
      labelA: "优化前",
      valueA: 30,
      labelB: "优化后",
      valueB: 5,
      unit: "名",
      gainText: "排名提升 25 位",
      accentColor: "#67e8f9",
    },
    propsSchema: {
      kicker: {type: "text", label: "角标"},
      title: {type: "text", label: "标题"},
      labelA: {type: "text", label: "对比项一"},
      valueA: {type: "number", label: "数值一", min: 0, max: 999, step: 1},
      labelB: {type: "text", label: "对比项二"},
      valueB: {type: "number", label: "数值二", min: 0, max: 999, step: 1},
      unit: {type: "text", label: "单位"},
      gainText: {type: "text", label: "提升文案"},
      accentColor: {type: "color", label: "强调色"},
    },
  },
  {
    id: "Checklist",
    name: "检查清单",
    description: "勾选动画的步骤清单",
    category: "structure",
    glyph: "✓",
    component: Checklist,
    durationInFrames: 826,
    bounds: {x: 0, y: 0, width: 1080, height: 620},
    defaultPosition: {x: 840, y: 320, scale: 1},
    defaultProps: {
      kicker: "安装 · 只要三步",
      i1: "官网安装 Node.js",
      s1: "一路下一步即可",
      i2: "命令行安装",
      s2: "npx @deepseek-ai/dsh web",
      i3: "让现有 Agent 帮你装",
      s3: "把仓库地址发给它",
      i4: "桌面客户端 + API Key",
      s4: "装好即用",
      itemStarts: "0.76|4.45|20.38|27.51",
      accentColor: "#67e8f9",
    },
    propsSchema: {
      kicker: {type: "text", label: "角标"},
      i1: {type: "text", label: "条目一"},
      s1: {type: "text", label: "说明一"},
      i2: {type: "text", label: "条目二"},
      s2: {type: "text", label: "说明二"},
      i3: {type: "text", label: "条目三"},
      s3: {type: "text", label: "说明三"},
      i4: {type: "text", label: "条目四"},
      s4: {type: "text", label: "说明四"},
      itemStarts: {type: "text", label: "逐条起始秒（|分隔）"},
      accentColor: {type: "color", label: "强调色"},
    },
  },
  {
    id: "StatGrid",
    name: "多指标矩阵",
    description: "2×2 信息卡片矩阵",
    category: "metric",
    glyph: "GRID",
    component: StatGrid,
    durationInFrames: 542,
    bounds: {x: 0, y: 0, width: 1080, height: 640},
    defaultPosition: {x: 840, y: 300, scale: 1},
    defaultProps: {
      kicker: "四种模式",
      i1: "标准模式",
      d1: "日常干活，体验相近",
      i2: "PTC 模式",
      d2: "批量多步骤任务",
      i3: "极简模式",
      d3: "开发者裸测模型",
      i4: "创造模式",
      d4: "搭积木拼插件 DIY",
      itemStarts: "1.53|5.5|11.46|16.2",
      accentColor: "#67e8f9",
    },
    propsSchema: {
      kicker: {type: "text", label: "角标"},
      i1: {type: "text", label: "卡片一"},
      d1: {type: "text", label: "描述一"},
      i2: {type: "text", label: "卡片二"},
      d2: {type: "text", label: "描述二"},
      i3: {type: "text", label: "卡片三"},
      d3: {type: "text", label: "描述三"},
      i4: {type: "text", label: "卡片四"},
      d4: {type: "text", label: "描述四"},
      itemStarts: {type: "text", label: "逐条起始秒（|分隔）"},
      accentColor: {type: "color", label: "强调色"},
    },
  },
  {
    id: "BulletStack",
    name: "逐条要点",
    description: "按台词逐条滑入的要点列表",
    category: "text",
    glyph: "▸",
    component: BulletStack,
    durationInFrames: 733,
    bounds: {x: 0, y: 0, width: 1080, height: 600},
    defaultPosition: {x: 840, y: 330, scale: 1},
    defaultProps: {
      kicker: "要点",
      i1: "要点一",
      s1: "",
      i2: "要点二",
      s2: "",
      i3: "",
      s3: "",
      i4: "",
      s4: "",
      itemStarts: "0|1.2|2.4|3.6",
      accentColor: "#67e8f9",
    },
    propsSchema: {
      kicker: {type: "text", label: "角标"},
      i1: {type: "text", label: "条目一"},
      s1: {type: "text", label: "说明一"},
      i2: {type: "text", label: "条目二"},
      s2: {type: "text", label: "说明二"},
      i3: {type: "text", label: "条目三"},
      s3: {type: "text", label: "说明三"},
      i4: {type: "text", label: "条目四"},
      s4: {type: "text", label: "说明四"},
      itemStarts: {type: "text", label: "逐条起始秒（|分隔）"},
      accentColor: {type: "color", label: "强调色"},
    },
  },
  {
    id: "CaptionHighlight",
    name: "字幕关键词高亮",
    description: "卡拉OK式逐字高亮字幕（台词时间轴内置于源码）",
    category: "text",
    glyph: "CC",
    component: CaptionHighlight,
    durationInFrames: 3915,
    bounds: {x: 0, y: 0, width: 1920, height: 120},
    defaultPosition: {x: 0, y: 960, scale: 1},
    defaultProps: {
      fontSize: 36,
      accentColor: "#67e8f9",
    },
    propsSchema: {
      fontSize: {type: "number", label: "字号", min: 20, max: 60, step: 1},
      accentColor: {type: "color", label: "强调色"},
    },
  },
  {
    id: "ChapterMarker",
    name: "章节进度条",
    description: "顶部总进度与流光扫过",
    category: "ui",
    glyph: "—",
    component: ChapterMarker,
    durationInFrames: 3915,
    bounds: {x: 0, y: 0, width: 1920, height: 10},
    defaultPosition: {x: 0, y: 0, scale: 1},
    defaultProps: {accentColor: "#67e8f9"},
    propsSchema: {accentColor: {type: "color", label: "强调色"}},
  },
  {
    id: "StatusMonitor",
    name: "LIVE 状态徽标",
    description: "闪烁红点与脉冲光环的状态徽标",
    category: "ui",
    glyph: "●",
    component: StatusMonitor,
    durationInFrames: 3915,
    bounds: {x: 0, y: 0, width: 240, height: 64},
    defaultPosition: {x: 1680, y: 14, scale: 1},
    defaultProps: {
      label: "LIVE · 保姆级教程",
      dotColor: "#f87171",
    },
    propsSchema: {
      label: {type: "text", label: "状态文字"},
      dotColor: {type: "color", label: "圆点颜色"},
    },
  },
  {
    id: "EndLockup",
    name: "结尾关注卡",
    description: "二维码与行动提示的结尾锁定",
    category: "brand",
    glyph: "QR",
    component: EndLockup,
    durationInFrames: 191,
    bounds: {x: 0, y: 0, width: 1080, height: 740},
    defaultPosition: {x: 840, y: 170, scale: 1},
    defaultProps: {
      title: "感谢观看",
      subtitle: "",
      accentColor: "#67e8f9",
    },
    propsSchema: {
      title: {type: "text", label: "主文案"},
      subtitle: {type: "text", label: "副文案"},
      accentColor: {type: "color", label: "强调色"},
    },
  },
];

// ============================================================
// 预设时间轴（25 FPS，视频 156.61 秒 → 3915 帧）
// ============================================================
export const MOTION_TIMELINE = [
  {
    componentId: "ChapterMarker",
    startFrame: 2,
    durationInFrames: 3914,
    position: {x: 0, y: 0, scale: 1},
    backgroundOpacity: 0,
  },
  {
    componentId: "StatusMonitor",
    startFrame: 2,
    durationInFrames: 3914,
    position: {x: 1680, y: 14, scale: 1},
    backgroundOpacity: 0.72,
  },
  {
    componentId: "CaptionHighlight",
    startFrame: 2,
    durationInFrames: 3914,
    position: {x: 0, y: 960, scale: 1},
    backgroundOpacity: 0,
  },
  {
    componentId: "TitleReveal",
    startFrame: 2,
    durationInFrames: 116,
    position: {x: 840, y: 110, scale: 1},
    backgroundOpacity: 0.8,
  },
  {
    componentId: "KeywordBurst",
    startFrame: 117,
    durationInFrames: 112,
    position: {x: 840, y: 420, scale: 1},
    backgroundOpacity: 0.78,
    props: {
      word: "AI Agent",
      word2: "= 大模型 + Harness",
      sub: "一个公式看懂 Harness",
      accentColor: "#67e8f9",
    },
  },
  {
    componentId: "KeywordBurst",
    startFrame: 230,
    durationInFrames: 126,
    position: {x: 840, y: 420, scale: 1},
    backgroundOpacity: 0.78,
    props: {
      word: "驯服野马",
      word2: "缰绳 · 马鞭 · 驾驭系统",
      sub: "装上 Harness，让 AI 干活不跑偏",
      accentColor: "#4ade80",
    },
  },
  {
    componentId: "KeywordBurst",
    startFrame: 356,
    durationInFrames: 106,
    position: {x: 840, y: 420, scale: 1},
    backgroundOpacity: 0.78,
    props: {
      word: "干活不跑偏",
      word2: "驯服后的 AI Agent",
      sub: "真实任务里不再放飞自我",
      accentColor: "#67e8f9",
    },
  },
  {
    componentId: "KeywordBurst",
    startFrame: 462,
    durationInFrames: 69,
    position: {x: 840, y: 420, scale: 1},
    backgroundOpacity: 0.78,
    props: {
      word: "能力天差地别",
      word2: "同样的模型 · 不同的 Harness",
      sub: "装备决定上限",
      accentColor: "#fbbf24",
    },
  },
  {
    componentId: "Leaderboard",
    startFrame: 531,
    durationInFrames: 189,
    position: {x: 420, y: 380, scale: 1},
    backgroundOpacity: 0.82,
    props: {
      kicker: "LAB TEST",
      title: "GPT 5.2 编码能力排名",
      labelA: "只换 Harness 前",
      valueA: 30,
      labelB: "只换 Harness 后",
      valueB: 5,
      unit: "名",
      gainText: "排名提升 25 位",
      accentColor: "#67e8f9",
    },
  },
  {
    componentId: "BulletStack",
    startFrame: 720,
    durationInFrames: 239,
    position: {x: 420, y: 240, scale: 1},
    backgroundOpacity: 0.8,
    props: {
      kicker: "DeepSeek Harness 更特别",
      i1: "给你一匹训练好的马",
      s1: "开箱即用",
      i2: "开放整个跑马场",
      s2: "自由定制",
      i3: "训练自己的 AI Agent",
      s3: "把组装权交给你",
      itemStarts: "3.50|4.02|7.08",
      accentColor: "#8b5cf6",
    },
  },
  {
    componentId: "Checklist",
    startFrame: 959,
    durationInFrames: 798,
    position: {x: 420, y: 230, scale: 1},
    backgroundOpacity: 0.82,
    props: {
      kicker: "安装 · 只要三步",
      i1: "官网安装 Node.js",
      s1: "一路下一步即可",
      i2: "命令行安装",
      s2: "npx @deepseek-ai/dsh web",
      i3: "让现有 Agent 帮你装",
      s3: "把仓库地址发给它",
      i4: "桌面客户端 + API Key",
      s4: "装好即用",
      itemStarts: "0.36|4.26|19.50|26.32",
      accentColor: "#67e8f9",
    },
  },
  {
    componentId: "StatGrid",
    startFrame: 1757,
    durationInFrames: 585,
    position: {x: 420, y: 220, scale: 1},
    backgroundOpacity: 0.8,
    props: {
      kicker: "四种模式",
      i1: "标准模式",
      d1: "日常干活，体验相近",
      i2: "PTC 模式",
      d2: "批量多步骤任务",
      i3: "极简模式",
      d3: "开发者裸测模型",
      i4: "创造模式",
      d4: "搭积木拼插件 DIY",
      itemStarts: "1.66|5.90|12.34|18.43",
      accentColor: "#67e8f9",
    },
  },
  {
    componentId: "BulletStack",
    startFrame: 2342,
    durationInFrames: 803,
    position: {x: 420, y: 240, scale: 1},
    backgroundOpacity: 0.8,
    props: {
      kicker: "Cordis 插件内核",
      i1: "一切皆插件",
      s1: "Everything is a Plugin",
      i2: "时间可组合",
      s2: "卸载后影响可彻底撤销",
      i3: "空间可组合",
      s3: "依赖变化自动恢复",
      i4: "事件日志",
      s4: "出 bug 顺着轨迹回翻",
      itemStarts: "3.41|5.36|11.82|28.32",
      accentColor: "#67e8f9",
    },
  },
  {
    componentId: "BulletStack",
    startFrame: 3144,
    durationInFrames: 376,
    position: {x: 420, y: 240, scale: 1},
    backgroundOpacity: 0.8,
    props: {
      kicker: "实战玩法",
      i1: "现成换肤插件",
      s1: "一键切换主题",
      i2: "一句话生成完整课程",
      s2: "课件 · 旁白 · 测验全自动",
      i3: "手搓生图插件",
      s3: "不懂代码也能做",
      itemStarts: "1.26|4.26|12.78",
      accentColor: "#4ade80",
    },
  },
  {
    componentId: "StatGrid",
    startFrame: 3520,
    durationInFrames: 204,
    position: {x: 420, y: 220, scale: 1},
    backgroundOpacity: 0.8,
    props: {
      kicker: "社区插件生态",
      i1: "换肤插件",
      d1: "一键切换主题",
      i2: "看余额",
      d2: "避免无意超支",
      i3: "备份数据",
      d3: "数据防丢",
      i4: "补记忆",
      d4: "跨会话记忆",
      itemStarts: "0.00|2.95|3.65|4.51",
      accentColor: "#8b5cf6",
    },
  },
  {
    componentId: "EndLockup",
    startFrame: 3724,
    durationInFrames: 191,
    position: {x: 840, y: 170, scale: 1},
    backgroundOpacity: 0.86,
  },
];

export default TitleReveal;
