// 範例資料，只供介面展示。接真正的檔案讀寫後整個換掉。
import type { Entry, FileDoc, GlossaryTerm, ProjectData, StoredMark } from '../model/types';

type Row = [key: string, src: string, tgt: string, mark: string, ctx: string];

const FILES: [string, string, Row[]][] = [
  ['dialogue_ch01.po', 'loc/zh-TW/dialogue_ch01.po', [
    ['npc_elder_001', '旅人，你終於來了。村子等你很久了。', "Traveler, you've finally come. The village has waited a long time for you.", 'verified', '說話者：村長（年邁、語氣溫和）'],
    ['npc_elder_002', '北方的霜牙山最近不太平靜，礦工們都不敢上山了。', "Things have been restless on Frostfang Peak to the north. The miners won't go up anymore.", 'doubt', '說話者：村長。霜牙山為專有名詞，請依術語表'],
    ['npc_elder_003', '帶上這把舊劍吧，它曾屬於我的兒子。', '', '', '說話者：村長。遞出道具「老舊的長劍」'],
    ['player_choice_001', '我會查清楚的。', "I'll find out what's going on.", 'verified', '玩家選項，上限 32 字元'],
    ['player_choice_002', '報酬是多少？', "What's the pay?", 'think', '玩家選項，上限 32 字元'],
    ['npc_elder_004', '報酬？……年輕人，有些事比金幣更重要。', '', '', '說話者：村長，回應 player_choice_002'],
    ['npc_smith_001', '要修裝備嗎？今天爐火正旺。', 'Need your gear fixed? The forge is roaring today.', 'c:c1', '說話者：鐵匠（豪爽、說話直接）'],
    ['npc_smith_002', '星鐵礦可不好找，你得去礦坑最深處。', '', '', '說話者：鐵匠'],
    ['npc_smith_003', '小心坑道裡的石像鬼，牠們只在夜裡活動。', '', '', '說話者：鐵匠'],
    ['dbg_placeholder_01', '（測試用對白，請勿翻譯）', '', 'ignore', '開發用佔位字串'],
    ['sys_quest_start', '任務開始：霜牙山的異變', 'Quest Started: Trouble on Frostfang Peak', '', '系統提示，顯示於畫面上方橫幅'],
  ]],
  ['items.po', 'loc/zh-TW/items.po', [
    ['item_potion_name', '回復藥水', 'Healing Potion', 'verified', '道具名稱，上限 20 字元'],
    ['item_potion_desc', '使用後恢復 {0} 點生命值。', 'Restores {0} HP.', '', '{0} 為數值變數，請保留'],
    ['item_ore_name', '星鐵礦', 'Starsteel Ore', 'c:c2', '道具名稱，上限 20 字元'],
    ['item_sword_name', '老舊的長劍', 'Worn Longsword', 'doubt', '道具名稱'],
    ['item_cloak_name', '旅人斗篷', '', '', '道具名稱'],
    ['item_untradable', '無法交易', '', '', '道具屬性標籤'],
  ]],
  ['ui_menu.po', 'loc/zh-TW/ui_menu.po', [
    ['menu_start', '開始遊戲', 'Start Game', 'verified', '主選單按鈕'],
    ['menu_continue', '繼續', 'Continue', 'verified', '主選單按鈕'],
    ['menu_settings', '設定', 'Settings', '', '主選單按鈕'],
    ['menu_volume', '音量', '', '', '設定頁項目'],
    ['menu_language', '語言', 'Language', '', '設定頁項目'],
    ['menu_quit_confirm', '確定要放棄目前進度嗎？', '', 'think', '確認對話框內文'],
  ]],
  ['quests.po', 'loc/zh-TW/quests.po', [
    ['quest_01_title', '霜牙山的異變', 'Trouble on Frostfang Peak', '', '任務標題'],
    ['quest_01_obj_1', '前往礦坑入口', 'Go to the mine entrance', '', '任務目標'],
    ['quest_01_obj_2', '擊敗 {0} 隻石像鬼', '', '', '{0} 為數量變數'],
    ['quest_01_reward', '獲得 {0} 金幣', 'Received {0} Gold', 'c:c3', '獎勵提示'],
  ]],
  ['skills.po', 'loc/zh-TW/skills.po', [
    ['skill_slash_name', '裂地斬', '', '', '技能名稱，上限 16 字元'],
    ['skill_slash_desc', '對前方敵人造成 {0}% 攻擊力的傷害。', '', '', '{0} 為百分比數值'],
    ['skill_guard_name', '鐵壁', 'Iron Wall', 'doubt', '技能名稱'],
    ['skill_guard_desc', '3 秒內受到的傷害降低 {0}%。', 'Reduces damage taken by {0}% for 3 seconds.', '', '{0} 為百分比數值'],
  ]],
];

const NOTES: Record<string, string> = {
  npc_elder_002: 'Frostfang Peak 前面要不要加 the？等企劃回覆',
  item_sword_name: 'Worn 還是 Old？語氣上想再斟酌',
  player_choice_002: '玩家語氣偏直接，pay 會不會太口語',
};

const SUGGS: Record<string, string> = {
  npc_smith_001: 'Need repairs? The forge is burning hot today.',
  item_sword_name: 'Old Longsword',
};

const GLOSS: [string, string, string, string][] = [
  ['旅人', 'Traveler', '術語表', '玩家角色的稱呼，首字大寫'],
  ['村子', 'village', '術語表', '指新手村，不用 town'],
  ['霜牙山', 'Frostfang Peak', '專有名詞', '已鎖定譯名，不可意譯'],
  ['礦工', 'miner', '術語表', ''],
  ['星鐵礦', 'Starsteel Ore', '專有名詞', '道具名，大寫'],
  ['石像鬼', 'Gargoyle', '專有名詞', '怪物名，複數 Gargoyles'],
  ['報酬', 'reward / pay', '術語表', '口語對話可用 pay'],
  ['金幣', 'Gold', '術語表', '貨幣單位，不加 coins'],
  ['長劍', 'Longsword', '術語表', ''],
  ['回復藥水', 'Healing Potion', '專有名詞', '道具名'],
  ['生命值', 'HP', '術語表', 'UI 內一律用 HP'],
  ['任務', 'Quest', '術語表', ''],
  ['爐火', 'forge', '術語表', '鐵匠台詞中指鍛造爐'],
  ['攻擊力', 'ATK', '術語表', 'UI 內一律用 ATK'],
];

const PROJECT = 'Frostfang 在地化專案';

export function sampleProject(): ProjectData {
  const files: FileDoc[] = FILES.map(([name, path, rows]) => ({
    name,
    path,
    entries: rows.map(([key, src, tgt, mark, ctx]): Entry => ({
      key, src, src0: src, tgt, tgt0: tgt,
      mark: mark as StoredMark,
      ctx, note: NOTES[key] ?? '', sugg: SUGGS[key] ?? '',
    })),
  }));
  const glossary: GlossaryTerm[] = GLOSS.map(([term, en, kind, note], i) => ({
    id: 'g' + i, term, en, note, proj: PROJECT,
    dict: kind === '專有名詞' ? '專有名詞' : /^UI/.test(note) ? 'UI 用語' : '一般術語',
  }));
  return {
    name: PROJECT,
    files,
    customMarks: [
      { id: 'c1', name: '術語待確認', kind: 'text', text: 'TM', color: '#4fb3a9' },
      { id: 'c2', name: '需問企劃', kind: 'sym', sym: 'star', color: '#b48cf2' },
      { id: 'c3', name: '字數超長', kind: 'text', text: '長', color: '#ec8a6a' },
    ],
    glossary,
    dicts: ['專有名詞', '一般術語', 'UI 用語'],
    projects: [PROJECT, '所有專案（共用）'],
    refs: [
      { name: '術語表.xlsx', desc: '專有名詞與鎖定譯名' },
      { name: '角色語氣設定.md', desc: '各 NPC 的說話風格' },
      { name: '英文風格指南.pdf', desc: '大小寫、標點、UI 字數限制' },
    ],
  };
}
