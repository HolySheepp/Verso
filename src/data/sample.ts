// 範例資料，只供介面展示。接真正的檔案讀寫後整個換掉。
import type { Entry, FileDoc, GlossaryTerm, ProjectData, StoredMark } from '../model/types';

type Row = [id: string, speaker: string, src: string, tgt: string, mark: string];

const FILES: [string, [string, Row[]][]][] = [
  ['Frostfang 第一章', [
    ['對話', [
      ['220001', '村長', '旅人，你終於來了。村子等你很久了。', "Traveler, you've finally come. The village has waited a long time for you.", 'verified'],
      ['220002', '村長', '北方的霜牙山最近不太平靜，礦工們都不敢上山了。', "Things have been restless on Frostfang Peak to the north. The miners won't go up anymore.", 'doubt'],
      ['220003', '村長', '帶上這把舊劍吧，它曾屬於我的兒子。', '', ''],
      ['220004', '玩家', '我會查清楚的。', "I'll find out what's going on.", 'verified'],
      ['220005', '玩家', '報酬是多少？', "What's the pay?", 'think'],
      ['220006', '村長', '報酬？……年輕人，有些事比金幣更重要。', '', ''],
      ['220007', '鐵匠', '要修裝備嗎？今天爐火正旺。', 'Need your gear fixed? The forge is roaring today.', 'c:c1'],
      ['220008', '鐵匠', '星鐵礦可不好找，你得去礦坑最深處。', '', ''],
      ['220009', '鐵匠', '小心坑道裡的石像鬼，牠們只在夜裡活動。', '', ''],
      ['220010', '無', '（測試用對白，請勿翻譯）', '', 'ignore'],
      ['220011', '系統', '任務開始：霜牙山的異變', 'Quest Started: Trouble on Frostfang Peak', ''],
    ]],
    ['道具', [
      ['310001', '無', '回復藥水', 'Healing Potion', 'verified'],
      ['310002', '無', '使用後恢復 {0} 點生命值。', 'Restores {0} HP.', ''],
      ['310003', '無', '星鐵礦', 'Starsteel Ore', 'c:c2'],
      ['310004', '無', '老舊的長劍', 'Worn Longsword', 'doubt'],
      ['310005', '無', '旅人斗篷', '', ''],
      ['310006', '無', '無法交易', '', ''],
    ]],
    ['介面', [
      ['400001', '無', '開始遊戲', 'Start Game', 'verified'],
      ['400002', '無', '繼續', 'Continue', 'verified'],
      ['400003', '無', '設定', 'Settings', ''],
      ['400004', '無', '音量', '', ''],
      ['400005', '無', '語言', 'Language', ''],
      ['400006', '系統', '確定要放棄目前進度嗎？', '', 'think'],
    ]],
  ]],
  ['Frostfang 任務與技能', [
    ['任務', [
      ['510001', '系統', '霜牙山的異變', 'Trouble on Frostfang Peak', ''],
      ['510002', '系統', '前往礦坑入口', 'Go to the mine entrance', ''],
      ['510003', '系統', '擊敗 {0} 隻石像鬼', '', ''],
      ['510004', '系統', '獲得 {0} 金幣', 'Received {0} Gold', 'c:c3'],
    ]],
    ['技能', [
      ['620001', '無', '裂地斬', '', ''],
      ['620002', '無', '對前方敵人造成 {0}% 攻擊力的傷害。', '', ''],
      ['620003', '無', '鐵壁', 'Iron Wall', 'doubt'],
      ['620004', '無', '3 秒內受到的傷害降低 {0}%。', 'Reduces damage taken by {0}% for 3 seconds.', ''],
    ]],
  ]],
];

const NOTES: Record<string, string> = {
  '220002': 'Frostfang Peak 前面要不要加 the？等企劃回覆',
  '310004': 'Worn 還是 Old？語氣上想再斟酌',
  '220005': '玩家語氣偏直接，pay 會不會太口語',
};

const SUGGS: Record<string, string> = {
  '220007': 'Need repairs? The forge is burning hot today.',
  '310004': 'Old Longsword',
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
  const files: FileDoc[] = FILES.map(([name, sheets]) => ({
    name,
    sheets: sheets.map(([sheetName, rows]) => ({
      name: sheetName,
      entries: rows.map(([id, speaker, src, tgt, mark]): Entry => ({
        uid: 's' + id, id, speaker, src, src0: src, tgt, tgt0: tgt,
        mark: mark as StoredMark, pending: false,
        note: NOTES[id] ?? '', sugg: SUGGS[id] ?? '',
      })),
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
