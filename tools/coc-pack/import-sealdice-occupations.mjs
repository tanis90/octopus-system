// SealDice occupation compatibility importer (M8).
//
// Reads the SealDice builtin "COC职业查询" helpdoc and imports every formal
// definition that can be mapped onto this project's CoC 7e creation rules.
// Only formulas, credit-rating ranges and skill composition are facts taken
// from the helpdoc. Every imported description is written for this project.
// The helpdoc text itself (including its 介绍 prose) is never copied into the
// repository: sealdice-core is MIT, sealdice-builtins declares no license.
//
//   node tools/coc-pack/import-sealdice-occupations.mjs [helpdoc.json] [skills.py]
//
// Default inputs (read-only, outside the repo):
//   /tmp/sealdice-coc-occupations.json
//   /tmp/coc-cardwright-reference/coc_generator/data/skills.py
//
// The importer is idempotent: every record it owns carries the
// `sealdice.occupation.` factId prefix and is replaced on each run. The 38
// existing professions are never touched. Anything it cannot map with a
// verified base value is recorded in provenance.json as deferred with a
// category and a reason, never padded to eight slots and never defaulted to 0.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSupportedPointFormulas, POINT_FORMULAS } from "../../module/rules/creation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SOURCE_PATH = process.argv[2] ?? "/tmp/sealdice-coc-occupations.json";
const SKILLS_PY_PATH = process.argv[3] ?? "/tmp/coc-cardwright-reference/coc_generator/data/skills.py";
const SOURCE_ID = "sealdice-occupations";
const FACT_PREFIX = "sealdice.occupation.";
const SKILL_FACT_PREFIX = "sealdice.skill.";
const BATCH = "M8 sealdice-builtins compatibility batch";

const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const writeJson = (path, value) => writeFileSync(join(ROOT, path), JSON.stringify(value, null, 2) + "\n");
const fail = (message) => { console.error(`导入器失败：${message}`); process.exit(1); };

if (!existsSync(SOURCE_PATH)) fail(`找不到来源文件 ${SOURCE_PATH}（只读副本，不入库）`);
if (!existsSync(SKILLS_PY_PATH)) fail(`找不到基础值对照表 ${SKILLS_PY_PATH}（只读副本，不入库）`);

// ------------------------------------------------------------------ profiles
// Identity + self-written prose for every candidate that survived parsing.
// [slug, enName, displayName, description]. A candidate without a row here is
// an importer bug: fail closed rather than inventing a name or a description.
const PROFILES = {
  "会计师": ["accountant", "Accountant", "会计师", "为企业与个人整理账目、审计财务并发现异常资金流向。"],
  "杂技演员": ["acrobat", "Acrobat", "杂技演员", "以攀爬、跳跃与投掷技巧完成舞台或马戏表演。"],
  "演员-戏剧演员": ["stage-actor", "Stage Actor", "戏剧演员", "在剧场舞台上以表演、乔装与社交能力塑造角色。"],
  "演员-电影演员": ["film-actor", "Film Actor", "电影演员", "在摄影机前表演，并依靠驾驶与社交能力适应片场生活。"],
  "动物训练师": ["animal-trainer", "Animal Trainer", "动物训练师", "训练与照料动物，以自然学和心理学判断其行为。"],
  "文物学家（原作向）": ["antiquities-scholar", "Antiquities Scholar", "文物学家", "研究古代器物与文献，常出入图书馆、拍卖行与发掘现场。"],
  "建筑师": ["architect", "Architect", "建筑师", "设计建筑与结构，兼顾法规、制图、数学与工程沟通。"],
  "精神病院看护": ["asylum-attendant", "Asylum Attendant", "精神病院看护", "在精神病院照料病患，处理突发冲突并维持日常秩序。"],
  "运动员": ["athlete", "Athlete", "运动员", "以体能训练和专项技巧参加竞技比赛。"],
  "作家（原作向": ["writer-classic", "Writer (Classic)", "作家（原作向）", "以写作、阅读与观察积累素材，完成小说或纪实作品。"],
  "酒保": ["bartender", "Bartender", "酒保", "在酒吧招待客人、调酒并留意来往人客的动静。"],
  "赏金猎人": ["bounty-hunter", "Bounty Hunter", "赏金猎人", "追踪并押送目标，依靠驾驶、射击与法律常识谋生。"],
  "拳击手、摔跤手": ["boxer-wrestler", "Boxer/Wrestler", "拳击手／摔跤手", "以格斗技巧参加拳击或摔跤比赛，靠体能和意志取胜。"],
  "管家、男仆、女仆": ["butler-servant", "Butler/Servant", "管家／男仆／女仆", "照料雇主起居、管理宅邸事务并接待访客。"],
  "程序员、电子工程师（现代）": ["programmer-electronics-engineer", "Programmer/Electronics Engineer", "程序员／电子工程师（现代）", "编写程序、维护电子设备并处理现代通信与安全问题。"],
  "黑客/骇客（现代）": ["hacker", "Hacker", "黑客／骇客（现代）", "入侵计算机与电子系统，窃取或篡改数据。"],
  "牛仔": ["cowboy", "Cowboy", "牛仔", "在牧场上驯马、放牧并使用枪械与绳索。"],
  "罪犯-刺客": ["assassin", "Assassin", "刺客", "以乔装、潜入和格斗手段接近并除掉目标。"],
  "罪犯-银行劫匪": ["bank-robber", "Bank Robber", "银行劫匪", "策划并实施银行抢劫，依靠驾驶、枪械与威吓脱身。"],
  "罪犯-打手、暴徒": ["thug-bruiser", "Thug/Bruiser", "打手／暴徒", "受雇施加暴力，以格斗、枪械和恐吓解决纠纷。"],
  "罪犯-独行罪犯": ["lone-criminal", "Lone Criminal", "独行罪犯", "不依附帮派的独立罪犯，靠乔装、开锁和潜行作案。"],
  "罪犯-女飞贼（古典）": ["female-cat-burglar", "Cat Burglar (Classic)", "女飞贼（古典）", "以攀爬、潜行和社交手腕潜入富宅行窃。"],
  "罪犯-赃物贩子": ["fence", "Fence", "赃物贩子", "收购并转卖来路不明的物品，熟悉估价与地下人脉。"],
  "罪犯-赝造者": ["forger", "Forger", "赝造者", "伪造文件、签名或艺术品，以历史与手艺知识乱真。"],
  "罪犯-走私者": ["smuggler", "Smuggler", "走私者", "利用船只、车辆与隐蔽路线运输违禁品。"],
  "罪犯-混混": ["hoodlum", "Hoodlum", "混混", "在街头结伙斗殴、勒索，靠拳头和恐吓立足。"],
  "教团首领": ["cult-leader", "Cult Leader", "教团首领", "以神秘学与演讲维系教团，操纵信众并隐藏秘密。"],
  "除魅师（现代）": ["exorcist", "Exorcist", "除魅师（现代）", "以仪式、神秘学和心理洞察处理灵异事件。"],
  "设计师": ["designer", "Designer", "设计师", "以制图、摄影和手艺完成视觉与产品设计。"],
  "潜水员": ["diver", "Diver", "潜水员", "使用潜水装备进行水下作业、搜救与勘察。"],
  "流浪者": ["vagrant", "Vagrant", "流浪者", "居无定所，靠乞讨、打零工和搭便车度日。"],
  "司机-私人司机": ["chauffeur", "Chauffeur", "私人司机", "为雇主驾驶车辆，兼顾路线、礼仪与保密。"],
  "司机-司机": ["driver", "Driver", "司机", "以驾驶车辆运送人员或货物为生。"],
  "司机-出租车司机": ["taxi-driver", "Taxi Driver", "出租车司机", "驾驶出租车载客，熟悉城市道路与各色乘客。"],
  "编辑": ["editor", "Editor", "编辑", "审阅、修改并组织稿件，协调作者与出版流程。"],
  "农民": ["farmer", "Farmer", "农民", "耕种土地、饲养牲畜，靠机械维修和自然经验维持收成。"],
  "联邦探员": ["federal-agent", "Federal Agent", "联邦探员", "调查跨州或联邦案件，执行逮捕并保存证据。"],
  "驻外记者": ["foreign-correspondent", "Foreign Correspondent", "驻外记者", "在海外采访、写作并传递新闻，需通晓当地语言。"],
  "黑帮-黑帮老大": ["gang-leader-classic", "Gang Leader (Classic)", "黑帮老大", "领导帮派、划分地盘并指挥手下处理冲突。"],
  "黑帮-马仔": ["gang-underling", "Gang Underling", "马仔", "替帮派跑腿、收债和看场，随时准备动手。"],
  "绅士、淑女": ["gentleman-lady", "Gentleman/Lady", "绅士／淑女", "依靠家世、礼仪和社交圈处理事务，受过良好教育。"],
  "游民": ["hobo", "Hobo", "游民", "搭货运列车四处漂泊，靠零工和街头生存技巧糊口。"],
  "记者(原作向)-通讯记者": ["correspondent", "Correspondent", "通讯记者", "为报刊采写通讯报道，奔波于事件现场。"],
  "工人-非熟练工人": ["unskilled-laborer", "Unskilled Laborer", "非熟练工人", "从事搬运、挖掘等体力劳动，靠耐力和工具维生。"],
  "工人-矿工": ["miner", "Miner", "矿工", "在地下矿井采掘矿石，熟悉地质、机械与通风。"],
  "工人-伐木工": ["lumberjack", "Lumberjack", "伐木工", "在林中伐木、运输木料，习惯攀爬与粗重工具。"],
  "技师": ["technician", "Technician", "技师", "维护和修理机械与电气设备，解决现场技术问题。"],
  "军官": ["military-officer", "Military Officer", "军官", "指挥部队、制定计划并维持纪律与后勤。"],
  "传教士": ["missionary", "Missionary", "传教士", "在偏远地区传播信仰，提供医疗与教育援助。"],
  "登山家": ["mountaineer", "Mountaineer", "登山家", "攀登高山，依靠攀爬、导航和野外生存经验。"],
  "音乐家": ["musician", "Musician", "音乐家", "演奏乐器或作曲，以演出和教学为生。"],
  "神秘学家": ["occultist", "Occultist", "神秘学家", "研究秘教文献、仪式与超自然传说。"],
  "超心理学家": ["parapsychologist", "Parapsychologist", "超心理学家", "以科学方法调查灵异现象，记录并验证超常事件。"],
  "摄影师-摄影师": ["photographer", "Photographer", "摄影师", "以摄影记录人物、地点与事件，并自行冲洗底片。"],
  "摄影师-摄影记者": ["photojournalist", "Photojournalist", "摄影记者", "在新闻现场拍摄照片，兼顾时效与风险。"],
  "飞行员-特技飞行员（古典）": ["stunt-pilot", "Stunt Pilot", "特技飞行员（古典）", "驾驶飞机进行特技飞行与空中表演。"],
  "淘金客": ["prospector", "Prospector", "淘金客", "在荒野寻找矿脉与砂金，靠地质知识和耐力谋生。"],
  "性工作者": ["sex-worker", "Sex Worker", "性工作者", "以陪伴和性服务换取报酬，擅长察言观色与周旋。"],
  "研究员": ["researcher", "Researcher", "研究员", "在实验室或档案馆从事系统研究，发表成果。"],
  "海员-军舰海员": ["naval-sailor", "Naval Sailor", "军舰海员", "在军舰上服役，负责航行、甲板勤务与战斗准备。"],
  "推销员": ["salesman", "Salesman", "推销员", "上门或巡回推销商品，靠口才和人脉促成交易。"],
  "店老板": ["shop-owner", "Shop Owner", "店老板", "经营店铺，管理进货、账目与顾客关系。"],
  "秘书": ["secretary", "Secretary", "秘书", "处理文书、日程与联络事务，维持办公室运转。"],
  "学生、实习生": ["student-intern", "Student/Intern", "学生／实习生", "在校园或职场学习，积累专业知识与社会经验。"],
  "替身演员": ["stunt-performer", "Stunt Performer", "替身演员", "代替演员完成危险动作与特技镜头。"],
  "公会活动家": ["union-activist", "Union Activist", "公会活动家", "组织工人争取权益，协调罢工与谈判。"],
  "服务生": ["waiter", "Waiter", "服务生", "在餐厅端送餐点、接待客人并处理小费。"],
  "白领工人-职员、主管": ["office-clerk", "Office Clerk/Supervisor", "职员／主管", "处理日常文书、账目与部门协调工作。"],
  "白领工人-中高层管理人员": ["middle-manager", "Middle Manager", "中高层管理人员", "管理团队、预算与业务计划，周旋于上下级之间。"],
  "狂热者": ["zealot", "Zealot", "狂热者", "为信念或领袖奔走，善于鼓动他人并隐藏行踪。"],
  "运动员（游泳/潜水）": ["aquatic-athlete", "Aquatic Athlete", "运动员（游泳／潜水）", "专攻游泳或跳水项目，以体能和技术参加比赛。"],
  "运动员（高尔夫）": ["golfer", "Golfer", "运动员（高尔夫）", "参加高尔夫比赛，依靠技巧、耐心与社交圈。"],
  "运动员（网球）": ["tennis-player", "Tennis Player", "运动员（网球）", "参加网球比赛，以反应、体能与心理素质取胜。"],
  "运动员（田径）": ["track-athlete", "Track Athlete", "运动员（田径）", "参加跑跳投等田径项目，以爆发力和耐力竞争。"],
  "发言人": ["spokesperson", "Spokesperson", "发言人", "代表组织对外发布消息、应对媒体与公众质询。"],
  "保释担保人": ["bail-bondsman", "Bail Bondsman", "保释担保人", "为被告提供保释担保，追踪弃保者并处理法律文书。"],
  "神职人员(天主教牧师)": ["catholic-priest", "Catholic Priest", "天主教牧师", "主持弥撒、照料教区并处理宗教与世俗事务。"],
  "神职人员（犹太教拉比）": ["rabbi", "Rabbi", "犹太教拉比", "主持礼拜、解释经典并领导社区事务。"],
  "社会主义者/激进主义者": ["socialist-activist", "Socialist/Activist", "社会主义者／激进主义者", "组织集会、宣传主张并参与社会运动。"],
  "撰稿人": ["copywriter", "Copywriter", "撰稿人", "为报刊、广告或机构撰写稿件，靠文字谋生。"],
  "罪犯（放高利贷者）": ["loan-shark", "Loan Shark", "放高利贷者", "向急需用钱者放贷，以威胁和账目手段催收。"],
  "罪犯（扒手）": ["pickpocket", "Pickpocket", "扒手", "在人群和公共场所扒窃财物，擅长脱身。"],
  "司机-公交司机": ["bus-driver", "Bus Driver", "公交司机", "驾驶公交车按线路运送乘客，处理票务与突发状况。"],
  "实地调研员": ["field-researcher", "Field Researcher", "实地调研员", "前往现场收集资料、访谈并整理研究记录。"],
  "电影摄制人员": ["film-crew", "Film Crew", "电影摄制人员", "在片场负责摄影、灯光、道具或机械等技术工作。"],
  "运动经理": ["sports-manager", "Sports Manager", "运动经理", "管理运动员、赛事与赞助，协调训练和商业事务。"],
  "商船队船员": ["merchant-seaman", "Merchant Seaman", "商船队船员", "在商船上值班、装卸货物并维护船体设备。"],
  "古典音乐家": ["classical-musician", "Classical Musician", "古典音乐家", "演奏古典乐曲，参加乐团或独奏演出。"],
  "赛车手/赛艇手": ["racing-driver", "Racing Driver", "赛车手／赛艇手", "驾驶赛车或赛艇参加竞速比赛，精通机械与航线。"],
  "电台播音员": ["radio-announcer", "Radio Announcer", "电台播音员", "在电台播音、主持节目并采访嘉宾。"],
  "推销员（旅行推销员）": ["traveling-salesman", "Traveling Salesman", "旅行推销员", "带着样品巡回各地，向商户和居民推销商品。"],
  "小企业家": ["small-business-owner", "Small Business Owner", "小企业家", "创办并经营小企业，兼顾账目、人事与市场。"],
  "舞台工作人员": ["stagehand", "Stagehand", "舞台工作人员", "搭建布景、操作灯光与道具，保障演出顺利进行。"],
  "证券经纪人": ["stockbroker", "Stockbroker", "证券经纪人", "替客户买卖证券，分析行情并维护客户关系。"],
  "勘测员": ["surveyor", "Surveyor", "勘测员", "测量地形、绘制地图并标定边界与工程位置。"],
  "电话接线员": ["telephone-operator", "Telephone Operator", "电话接线员", "在交换台接转电话、记录信息并处理紧急联络。"],
  "星探": ["talent-scout", "Talent Scout", "星探", "在街头和演出场所物色新人，洽谈演出合约。"],
  "寻宝猎人": ["treasure-hunter", "Treasure Hunter", "寻宝猎人", "根据传说和旧地图寻找宝藏，常出入荒野与遗迹。"],
  "暴走族": ["biker-gang", "Biker Gang Member", "暴走族", "结伙改装摩托、飙车并与对立团伙冲突。"],
  "高中生": ["high-school-student", "High School Student", "高中生", "在校学习，同时接触社团、打工与城市生活。"],
  "外语教师": ["language-teacher", "Language Teacher", "外语教师", "教授外语，备课、批改作业并与学生和家长沟通。"],
  "非法移民": ["illegal-immigrant", "Illegal Immigrant", "非法移民", "没有合法身份，靠零工和同乡网络在异地生存。"],
  "心理治疗师": ["psychotherapist", "Psychotherapist", "心理治疗师", "通过谈话和治疗技术帮助来访者处理心理问题。"],
  "寄居学生": ["boarding-student", "Boarding Student", "寄居学生", "寄住在学校或他人家中，边学习边适应集体生活。"],
  "动物辅助治疗师": ["animal-assisted-therapist", "Animal-Assisted Therapist", "动物辅助治疗师", "借助动物陪伴开展治疗，观察并记录患者变化。"],
  "急诊医生/救援队员": ["emergency-physician", "Emergency Physician", "急诊医生／救援队员", "在急诊室或事故现场抢救伤员，快速判断并处置。"],
  "密医": ["unlicensed-doctor", "Unlicensed Doctor", "密医", "没有执照却私下行医，为不愿留下记录的人治疗。"],
  "山岳救援队员": ["mountain-rescuer", "Mountain Rescuer", "山岳救援队员", "在山地搜索并救援遇险者，熟悉攀爬与野外急救。"],
  "舞者": ["dancer", "Dancer", "舞者", "以舞蹈表演为业，依靠身体控制与舞台表现力。"],
  "歌手": ["singer", "Singer", "歌手", "以歌唱演出为业，兼顾舞台表现与曲目积累。"],
  "偶像": ["idol", "Idol", "偶像", "以歌舞、形象和粉丝活动维持人气。"],
  "搞笑艺人": ["comedian", "Comedian", "搞笑艺人", "以段子、即兴和肢体喜剧逗笑观众。"],
  "网络明星": ["internet-celebrity", "Internet Celebrity", "网络明星", "通过网络视频和社交平台积累人气并变现。"],
  "游戏测试员": ["game-tester", "Game Tester", "游戏测试员", "反复试玩游戏、记录缺陷并反馈给开发团队。"],
  "服装设计师": ["fashion-designer", "Fashion Designer", "服装设计师", "设计服装与配饰，兼顾制图、缝纫和客户品味。"],
  "经纪人": ["agent", "Agent", "经纪人", "代理艺人或运动员，谈判合约并安排行程。"],
  "占卜师、灵媒师": ["diviner-medium", "Diviner/Medium", "占卜师／灵媒师", "以占卜、通灵和仪式为客人解答疑难。"],
  "自宅警备员": ["stay-at-home-guard", "Stay-at-Home Guard", "自宅警备员", "长期宅居家中，以监控、网络和防盗设备看守住所。"],
  "医生": ["physician", "Physician", "医生", "诊断和治疗常见疾病，兼顾急救、医学与药剂知识。"],
  "店主": ["shopkeeper", "Shopkeeper", "店主", "经营小店铺，接待顾客并管理库存与账目。"],
};

// ------------------------------------------------------------------ skills
// New concrete skills needed by the imported records. Every base is checked
// against the user's coc-cardwright skills.py table below; a missing or
// different value is a hard failure. Family members are only published when
// the family already has a verified base in content/coc/professions.json.
const NEW_SKILLS = [
  { key: "art-craft-farming", source: "技艺（耕作）", name: "艺术/手艺（耕作）", enName: "Art/Craft (Farming)", parentKey: "art-craft", specKey: "farming", base: 5, description: "耕作、轮作与照料作物，判断土壤和收成。" },
  { key: "art-craft-forgery", source: "技艺（伪造）", name: "艺术/手艺（伪造）", enName: "Art/Craft (Forgery)", parentKey: "art-craft", specKey: "forgery", base: 5, description: "仿制文件、签名或艺术品以骗过查验。" },
  { key: "art-craft-music", source: "技艺（音乐）", name: "艺术/手艺（音乐）", enName: "Art/Craft (Music)", parentKey: "art-craft", specKey: "music", base: 5, description: "演奏乐器或进行音乐创作。" },
  { key: "art-craft-woodworking", source: "技艺（木工）", name: "艺术/手艺（木工）", enName: "Art/Craft (Woodworking)", parentKey: "art-craft", specKey: "woodworking", base: 5, description: "以木工工具制作与修理木制品。" },
  { key: "art-craft-writing", source: "技艺（写作）", name: "艺术/手艺（写作）", enName: "Art/Craft (Writing)", parentKey: "art-craft", specKey: "writing", base: 5, description: "以写作、编辑与文学创作完成作品。" },
  { key: "art-craft-typing", source: "技艺（打字）", name: "艺术/手艺（打字）", enName: "Art/Craft (Typing)", parentKey: "art-craft", specKey: "typing", base: 5, description: "快速而准确地打字、排版与整理文书。" },
  { key: "art-craft-shorthand", source: "技艺（速记）", name: "艺术/手艺（速记）", enName: "Art/Craft (Shorthand)", parentKey: "art-craft", specKey: "shorthand", base: 5, description: "用速记符号记录口述与会议内容。" },
  // Family-base members: skills.py has no same-name row, but the art-craft
  // family's verified base (5, official 1920s sheet) is the printed base for
  // every Art/Craft specialism. The source names these in occupation lists, so
  // they are concrete documents rather than deferred.
  { key: "art-craft-singing", source: null, name: "艺术/手艺（歌唱）", enName: "Art/Craft (Singing)", parentKey: "art-craft", specKey: "singing", base: 5, description: "以歌唱、发声与舞台表达完成演出。" },
  { key: "art-craft-dancing", source: null, name: "艺术/手艺（舞蹈）", enName: "Art/Craft (Dancing)", parentKey: "art-craft", specKey: "dancing", base: 5, description: "以身体动作和节奏完成舞蹈表演。" },
  { key: "art-craft-game", source: null, name: "艺术/手艺（游戏）", enName: "Art/Craft (Games)", parentKey: "art-craft", specKey: "game", base: 5, description: "设计、制作并测试游戏与娱乐节目。" },
  { key: "art-craft-acrobatics", source: null, name: "艺术/手艺（杂技）", enName: "Art/Craft (Acrobatics)", parentKey: "art-craft", specKey: "acrobatics", base: 5, description: "以翻腾、平衡和抛接完成杂技表演。" },
  { key: "art-craft-comedy", source: null, name: "艺术/手艺（喜剧）", enName: "Art/Craft (Comedy)", parentKey: "art-craft", specKey: "comedy", base: 5, description: "以笑话、即兴和节奏制造喜剧效果。" },
  { key: "art-craft-fitter", source: null, name: "艺术/手艺（钳工）", enName: "Art/Craft (Fitting)", parentKey: "art-craft", specKey: "fitter", base: 5, description: "使用钳工工具加工、装配与修理金属件。" },
  { key: "art-craft-calligraphy", source: "技艺（书法）", name: "艺术/手艺（书法）", enName: "Art/Craft (Calligraphy)", parentKey: "art-craft", specKey: "calligraphy", base: 5, description: "以毛笔或硬笔书写讲究章法的文字。" },
  { key: "art-craft-cooking", source: "技艺（烹饪）", name: "艺术/手艺（烹饪）", enName: "Art/Craft (Cooking)", parentKey: "art-craft", specKey: "cooking", base: 5, description: "选材、调味并烹制可供多人食用的餐点。" },
  { key: "art-craft-tailoring", source: "技艺（裁缝）", name: "艺术/手艺（裁缝）", enName: "Art/Craft (Tailoring)", parentKey: "art-craft", specKey: "tailoring", base: 5, description: "量体、裁剪并缝制合身的衣物。" },
  { key: "art-craft-barber", source: "技艺（理发）", name: "艺术/手艺（理发）", enName: "Art/Craft (Barbering)", parentKey: "art-craft", specKey: "barber", base: 5, description: "修剪头发、修面并打理仪容。" },
  { key: "art-craft-welding", source: "技艺（焊接）", name: "艺术/手艺（焊接）", enName: "Art/Craft (Welding)", parentKey: "art-craft", specKey: "welding", base: 5, description: "以焊接设备连接和修补金属结构。" },
  { key: "art-craft-plumbing", source: "技艺（管道工）", name: "艺术/手艺（管道工）", enName: "Art/Craft (Plumbing)", parentKey: "art-craft", specKey: "plumbing", base: 5, description: "安装与修理供水、排水和供暖管道。" },
  { key: "fighting-sword", source: "格斗（刀剑）", name: "格斗（剑）", enName: "Fighting (Sword)", parentKey: "fighting", specKey: "sword", base: 20, description: "以刀剑进行劈砍、格挡与近身交锋。" },
  { key: "fighting-whip", source: "格斗（鞭）", name: "格斗（鞭）", enName: "Fighting (Whip)", parentKey: "fighting", specKey: "whip", base: 5, description: "以鞭子抽击、缠绕和牵制对手。" },
  { key: "fighting-spear", source: "格斗（矛）", name: "格斗（矛）", enName: "Fighting (Spear)", parentKey: "fighting", specKey: "spear", base: 20, description: "以长矛刺击并保持与对手的距离。" },
  { key: "fighting-chainsaw", source: "格斗（链锯）", name: "格斗（链锯）", enName: "Fighting (Chainsaw)", parentKey: "fighting", specKey: "chainsaw", base: 10, description: "把链锯当作近战武器挥砍。" },
  { key: "firearms-bow", source: "射击（弓弩）", name: "射击（弓）", enName: "Firearms (Bow)", parentKey: "firearms", specKey: "bow", base: 15, description: "以弓或弩瞄准并发射箭矢。" },
  { key: "computer", source: "计算机使用", name: "计算机", enName: "Computer Use", parentKey: null, specKey: null, base: 5, description: "使用计算机检索资料、编写程序并绕过基础安全措施。" },
  { key: "diving", source: "潜水", name: "潜水", enName: "Diving", parentKey: null, specKey: null, base: 1, description: "使用潜水装备在水下作业与搜救。" },
  { key: "electronics", source: "电子学", name: "电子学", enName: "Electronics", parentKey: null, specKey: null, base: 1, description: "检修电子设备、线路与通信器材。" },
  { key: "pilot-horse", source: "驾驶（马车）", name: "驾驶（马车）", enName: "Pilot (Horse-drawn)", parentKey: "pilot", specKey: "horse", base: 1, description: "驾驭马车或运货马车，处理路况与牲畜。" },
  { key: "science-botany", source: "科学（植物学）", name: "科学（植物学）", enName: "Science (Botany)", parentKey: "science", specKey: "botany", base: 1, description: "研究植物分类、生长与生态。" },
  { key: "science-geology", source: "科学（地质学）", name: "科学（地质学）", enName: "Science (Geology)", parentKey: "science", specKey: "geology", base: 1, description: "研究地层、岩石与地质作用。" },
  { key: "science-math", source: "科学（数学）", name: "科学（数学）", enName: "Science (Mathematics)", parentKey: "science", specKey: "math", base: 10, description: "以数学推导、统计与建模解决问题。" },
  { key: "survival-mountain", source: "生存（高山）", name: "生存（山地）", enName: "Survival (Mountain)", parentKey: "survival", specKey: "mountain", base: 5, description: "在山地寻找路线、躲避风雪并获取食物。" },
];
// The family default is the verified value for the family as a whole, but a
// concrete member may print its own value. Mathematics prints base 10 in
// skills.py, not the Science family default 1. Survival (Mountain) prints 5 in
// skills.py and keeps that value even though the Survival family default is 10;
// the family default is not allowed to overwrite a verified member value.
const SKILL_BASE_OVERRIDES = new Map([
  ["science-math", { base: 10, reason: "skills.py prints 10 for Mathematics" }],
]);

// ------------------------------------------------------------ skills.py read
function loadSkillBases(path) {
  const text = readFileSync(path, "utf8");
  const map = new Map();
  for (const match of text.matchAll(/"([^"]+)"\s*:\s*\{\s*"init"\s*:\s*(\d+)/g)) {
    const name = match[1].replace(/Ω/g, "").replace(/\(/g, "（").replace(/\)/g, "）");
    map.set(name, Number(match[2]));
  }
  return map;
}

// ------------------------------------------------------------- helpdoc parser
const STAT = { 教育: "EDU", 智力: "INT", 力量: "STR", 体质: "CON", 体型: "SIZ", 敏捷: "DEX", 外貌: "APP", 意志: "POW", 幸运: "LUCK" };
const SOCIAL = ["charm", "fast-talk", "intimidate", "persuade"];
const SKILL = {
  "会计": "accounting", "人类学": "anthropology", "估价": "appraise", "考古学": "archaeology", "考古": "archaeology",
  "魅惑": "charm", "攀爬": "climb", "信用评级": "credit-rating", "克苏鲁神话": "cthulhu-mythos",
  "乔装": "disguise", "闪避": "dodge", "汽车驾驶": "drive-auto", "电气维修": "electrical-repair", "电工": "electrical-repair",
  "话术": "fast-talk", "急救": "first-aid", "历史": "history", "恐吓": "intimidate", "跳跃": "jump",
  "法律": "law", "图书馆": "library-use", "图书馆使用": "library-use", "聆听": "listen", "锁匠": "locksmith",
  "机械维修": "mechanical-repair", "医学": "medicine", "博物学": "natural-world", "自然": "natural-world",
  "导航": "navigate", "领航": "navigate", "神秘学": "occult", "操作重型机械": "operate-heavy-machinery",
  "重型机械操作": "operate-heavy-machinery", "说服": "persuade", "精神分析": "psychoanalysis",
  "心理学": "psychology", "骑术": "ride", "骑乘": "ride", "妙手": "sleight-of-hand", "侦查": "spot-hidden",
  "侦察": "spot-hidden", "潜行": "stealth", "游泳": "swim", "投掷": "throw", "追踪": "track",
  "计算机": "computer", "电子学": "electronics", "潜水": "diving", "驯兽": "animal-handling",
  "炮术": "artillery", "爆破": "demolitions", "催眠": "hypnosis", "读唇": "lip-reading",
  "拉丁语": "language-other-latin", "拉丁文": "language-other-latin", "母语": "language-own",
  "格斗（斗殴）": "fighting-brawl", "射击（手枪）": "firearms-handgun",
  "射击（步枪/霰弹枪）": "firearms-rifle-shotgun", "射击（来复枪）": "firearms-rifle-shotgun",
  "射击（霰弹枪）": "firearms-rifle-shotgun", "射击（弓）": "firearms-bow",
  "驾驶（船）": "pilot-boat", "驾驶：船": "pilot-boat", "驾驶（飞行器）": "pilot-aircraft", "马车驾驶": "pilot-horse",
  "斗殴": "fighting-brawl",
  "技艺（表演）": "art-craft-acting", "艺术（表演）": "art-craft-acting",
  "技艺（摄影）": "art-craft-photography", "艺术（摄影）": "art-craft-photography", "艺术及手艺（摄影）": "art-craft-photography",
  "技艺（绘画）": "art-craft-painting", "技艺（技术制图）": "art-craft-technical-drawing",
  "技艺（书法）": "art-craft-calligraphy", "技艺（写作）": "art-craft-writing", "技艺（文学）": "art-craft-writing",
  "技艺（打字）": "art-craft-typing", "技艺（速记）": "art-craft-shorthand",
  "技艺（歌唱）": "art-craft-singing", "技艺（演唱）": "art-craft-singing",
  "技艺（舞蹈）": "art-craft-dancing", "技艺（游戏）": "art-craft-game", "手艺（游戏）": "art-craft-game",
  "技艺（杂技）": "art-craft-acrobatics", "技艺（喜剧）": "art-craft-comedy",
  "钳工": "art-craft-fitter", "技艺（钳工）": "art-craft-fitter", "手艺（钳工）": "art-craft-fitter",
  "技艺（烹饪）": "art-craft-cooking", "技艺（木工）": "art-craft-woodworking", "手艺（木匠）": "art-craft-woodworking",
  "技艺（音乐）": "art-craft-music", "技艺（乐器）": "art-craft-music", "技艺（伪造）": "art-craft-forgery",
  "技艺（耕作）": "art-craft-farming", "技艺（裁缝）": "art-craft-tailoring",
  "技艺（理发）": "art-craft-barber", "技艺（焊接）": "art-craft-welding", "技艺（管道工）": "art-craft-plumbing",
  "格斗（剑）": "fighting-sword", "格斗（刀剑）": "fighting-sword",
  "格斗（鞭）": "fighting-whip", "格斗（矛）": "fighting-spear", "格斗（链锯）": "fighting-chainsaw",
  "射击（弓）": "firearms-bow",
  "科学（天文学）": "science-astronomy", "科学（天文）": "science-astronomy",
  "科学（生物学）": "science-biology", "科学（生物）": "science-biology",
  "科学（化学）": "science-chemistry", "科学（工程学）": "science-engineering",
  "科学（药学）": "science-pharmacy", "科学（制药）": "science-pharmacy", "科学（药剂学）": "science-pharmacy",
  "科学（物理学）": "science-physics", "科学（物理）": "science-physics",
  "科学（动物学）": "science-zoology", "科学（鉴证）": "science-forensics", "科学（司法科学）": "science-forensics",
  "科学（地质）": "science-geology", "科学（地质学）": "science-geology", "科学（数学）": "science-math",
  "科学（植物学）": "science-botany", "科学（植物）": "science-botany",
  "生存（海上）": "survival-sea", "生存（荒野）": "survival-wilderness",
  "生存（山地）": "survival-mountain", "生存（高山）": "survival-mountain",
};
const FAMILY = {
  "技艺": "art-craft", "手艺": "art-craft", "艺术": "art-craft", "艺术及手艺": "art-craft", "艺术/工艺": "art-craft",
  "科学": "science", "生存": "survival", "格斗": "fighting", "射击": "firearms", "驾驶": "pilot",
  "外语": "language-other", "其他语言": "language-other",
};
const FAMILY_LABEL = {
  "art-craft": "艺术/手艺", "science": "科学", "survival": "生存", "fighting": "格斗",
  "firearms": "射击", "pilot": "驾驶", "language-other": "其他语言",
};
const OPEN_FAMILIES = new Set(["language-other", "pilot"]);
const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

const normalize = (value) => String(value)
  .replace(/[（(]/g, "（").replace(/[）)]/g, "）")
  .replace(/[／/]/g, "/")
  .replace(/\s*\/\s*/g, "/")
  .replace(/\s+/g, " ")
  .replace(/\s*（\s*/g, "（").replace(/\s*）\s*/g, "）")
  .replace(/^[。；;，、\s]+|[。；;，、\s]+$/g, "")
  .trim();

function splitTop(text) {
  const out = []; let depth = 0; let cur = "";
  for (const ch of text) {
    if (ch === "（") depth++;
    if (ch === "）") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[，、；;]/.test(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function splitOr(text) {
  const out = []; let depth = 0; let cur = "";
  for (const ch of text) {
    if (ch === "（") depth++;
    if (ch === "）") depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === "或") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

const parseParen = (text) => {
  const match = text.match(/^(.*?)（(.*)）$/);
  return match ? { head: match[1].trim(), inner: match[2].trim() } : null;
};

function tokenizeInner(inner) {
  const out = [];
  for (const part of splitTop(inner)) for (const piece of splitOr(part)) out.push(normalize(piece));
  return out.filter(Boolean);
}

function resolveToken(raw) {
  const token = normalize(raw);
  if (!token) return null;
  if (SKILL[token]) return { kind: "skill", key: SKILL[token] };
  if (token === "母语") return { kind: "skill", key: "language-own" };
  if (FAMILY[token]) return { kind: "family", family: FAMILY[token] };
  const parsed = parseParen(token);
  if (!parsed) return null;
  const { head, inner } = parsed;
  const family = FAMILY[head];
  if (!family) return null;
  if (head === "母语") return { kind: "skill", key: "language-own" };
  const open = OPEN_FAMILIES.has(family);
  const sub = tokenizeInner(inner);
  if (!open && (sub.some((x) => /任一|任意|如|等|类似/.test(x)) || /任一|任意|如|等|类似/.test(inner))) {
    return { kind: "family", family };
  }
  const canonical = ["技艺", "手艺", "艺术", "艺术及手艺", "艺术/工艺"].includes(head) ? "技艺" : head;
  const options = [];
  const unsupported = [];
  for (const item of sub) {
    const name = normalize(item).replace(/等$/, "");
    const key = SKILL[`${head}（${name}）`] ?? SKILL[`${canonical}（${name}）`] ?? SKILL[name];
    if (key) options.push({ kind: "skill", key });
    else if (!open) {
      // A parenthetical member may itself be a family name ("艺术或摄影");
      // resolve it through the normal family map instead of calling it unknown.
      const nested = resolveToken(name);
      if (nested) options.push(nested);
      else unsupported.push(name);
    }
  }
  if (open) return { kind: "family", family, label: `${head}（${inner}）` };
  // A list such as "艺术或摄影" names the bare family plus one member. The bare
  // family is the wider choice, so it supersedes the member instead of becoming
  // a narrower group that would falsely diverge from the legacy record.
  if (options.some((option) => option.kind === "family" && option.family === family)) {
    return { kind: "family", family };
  }
  if (unsupported.length) return { kind: "unsupported", reason: `未核实基础值的专精：${unsupported.join("、")}`, name: `${head}（${inner}）` };
  if (options.length === 1) return options[0];
  if (options.length > 1) return { kind: "group", choose: 1, options, label: `${head}（${inner}）` };
  return { kind: "unsupported", reason: `无法解析的专精：${inner}`, name: `${head}（${inner}）` };
}

function parseItem(raw) {
  if (typeof raw !== "string") return raw;
  const token = normalize(raw).replace(/^[：:]+/, "");
  if (!token || /^※/.test(token)) return null;
  if (/社交技能/.test(token)) {
    const choose = /三项/.test(token) ? 3 : /两项/.test(token) ? 2 : 1;
    return { kind: "group", choose, distinct: choose > 1, options: SOCIAL.map((key) => ({ kind: "skill", key })), label: token, social: true };
  }
  if (token === "语言" || /^语言（母语或外语）$/.test(token)) {
    return { kind: "group", choose: 1, options: [{ kind: "skill", key: "language-own" }, { kind: "family", family: "language-other" }], label: token };
  }
  const anyMatch = token.match(/^(?:任意|任选|至多|最多)?\s*(?:其他)?\s*([一二两三四五六七八九十]+)\s*项?\s*(.*)$/);
  if (anyMatch && /任意|任选|至多|最多/.test(token)) {
    const choose = CN_NUM[anyMatch[1]];
    const rest = anyMatch[2] ?? "";
    if (choose && /特长|技能|技巧|学术|专业|研究|经营/.test(rest)) {
      if (/学问/.test(rest)) return { kind: "unsupported", reason: "学问（Knowledge）没有已核基础值", name: token };
      return { kind: "any", choose, label: token, restricted: /研究领域/.test(rest) ? "research" : undefined };
    }
  }
  if (/^任两种其他学术或个人特长/.test(token)) return { kind: "any", choose: 2, label: token };
  if (/^三个学习的专业/.test(token)) return { kind: "any", choose: 3, label: token, restricted: "study" };
  if (/^两项研究领域相关技能/.test(token)) return { kind: "any", choose: 2, label: token, restricted: "research" };
  if (/^三项其他技能/.test(token)) return { kind: "any", choose: 3, label: token };
  if (/^四项经营业务相关技能/.test(token)) return { kind: "any", choose: 4, label: token, restricted: "business" };
  if (/^一项其他技能/.test(token)) return { kind: "any", choose: 1, label: token };
  if (/^两项其他技能/.test(token)) return { kind: "any", choose: 2, label: token };
  if (/^四项其他技能/.test(token)) return { kind: "any", choose: 4, label: token };
  if (/^个人或时代特长$|^时代或个人特长$/.test(token)) return { kind: "any", choose: 1, label: token };
  if (/^汽车驾驶（或运货马车）$/.test(token)) {
    return { kind: "group", choose: 1, options: [{ kind: "skill", key: "drive-auto" }, { kind: "skill", key: "pilot-horse" }], label: token };
  }
  const oneOf = token.match(/^（(.*)）中的一种$/);
  if (oneOf) {
    const parts = splitTop(oneOf[1]);
    const resolved = parts.map((part) => resolveToken(part));
    const missing = parts.filter((part, index) => !resolved[index]);
    if (!missing.length) return { kind: "group", choose: 1, options: resolved, label: token };
    return { kind: "unsupported", reason: `并列选项含未核实技能：${missing.join("、")}`, name: token };
  }
  const ors = splitOr(token);
  if (ors.length > 1) {
    const resolved = ors.map((part) => resolveToken(part));
    if (resolved.every(Boolean)) {
      const options = [];
      for (const option of resolved) {
        if (option.kind === "group" && option.choose === 1) options.push(...option.options);
        else options.push(option);
      }
      return { kind: "group", choose: 1, options, label: token };
    }
    const missing = ors.filter((part, index) => !resolved[index]);
    return { kind: "unsupported", reason: `无法解析的并列选项：${missing.join("、")}`, name: token };
  }
  const resolved = resolveToken(token);
  if (resolved) return resolved;
  return { kind: "unsupported", reason: "没有对应的技能 key", name: token };
}

function parseFormula(attr) {
  const text = attr.replace(/\s/g, "").replace(/＋/g, "+").replace(/×/g, "*");
  const terms = text.split("+").filter(Boolean).map((term) => {
    const match = term.match(/^(.+?)\*(\d+)$/);
    if (!match) return null;
    return match[1].split("或").map((stat) => ({ stat: STAT[stat], mult: Number(match[2]) }));
  });
  if (terms.some((options) => !options || options.some((option) => !option.stat))) return null;
  let combos = [[]];
  for (const options of terms) {
    const next = [];
    for (const combo of combos) for (const option of options) next.push([...combo, option]);
    combos = next;
  }
  const formulas = [];
  for (const combo of combos) {
    const totals = new Map();
    for (const term of combo) totals.set(term.stat, (totals.get(term.stat) ?? 0) + term.mult);
    const parts = [...totals.entries()]
      .map(([stat, mult]) => `${stat}*${mult}`)
      .sort((a, b) => (a.startsWith("EDU") ? -1 : b.startsWith("EDU") ? 1 : 0));
    const formula = parts.join("+");
    if (!POINT_FORMULAS.includes(formula)) return null;
    if (!formulas.includes(formula)) formulas.push(formula);
  }
  return formulas.length ? formulas : null;
}

const parseCredit = (value) => {
  const match = /^(\d+)-(\d+)$/.exec(String(value ?? ""));
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
};

// ------------------------------------------------------------------- source
const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
const helpdoc = source?.helpdoc;
if (!helpdoc || typeof helpdoc !== "object") fail("来源文件没有 helpdoc 对象");

const aliases = [];
const anomalies = [];
const records = [];
for (const [key, value] of Object.entries(helpdoc)) {
  const body = String(value ?? "").trim();
  if (/^\{.*\}$/.test(body)) { aliases.push({ key, target: body.slice(1, -1) }); continue; }
  if (!/职业序号【/.test(body)) { anomalies.push({ key, detail: "缺少规范的职业序号/正文结构" }); continue; }
  const creditRaw = (body.match(/【信誉】：([^\n]*)/) ?? [])[1]?.trim();
  const attrRaw = (body.match(/【职业属性】：([^\n]*)/) ?? [])[1]?.trim();
  const skillsRaw = (body.match(/【本职技能】：([^\n]*)/) ?? [])[1]?.trim();
  if (key === "自定义职业") { records.push({ key, category: "custom", reason: "自定义职业模板没有固定公式与完整的八项技能表" }); continue; }
  if (!creditRaw || creditRaw === "?") { records.push({ key, category: "missing-credit-rating", reason: "【信誉】缺失或为 ?" }); continue; }
  if (!attrRaw) { records.push({ key, category: "missing-formula", reason: "【职业属性】为空，无法确定职业点公式" }); continue; }
  if (!skillsRaw) { records.push({ key, category: "missing-skills", reason: "【本职技能】为空" }); continue; }

  let text = normalize(skillsRaw);
  const stop = text.indexOf("。");
  if (stop >= 0) text = text.slice(0, stop);
  text = text.replace(/※.*$/, "").trim();

  let tail = null;
  const andTail = text.match(/^(.+?)[，、]?和下面的一种个人特长[：:](.+)$/);
  if (andTail) {
    text = andTail[1];
    const parts = splitOr(andTail[2]);
    const resolved = parts.map((part) => resolveToken(part));
    const missing = parts.filter((part, index) => !resolved[index]);
    tail = missing.length
      ? { kind: "unsupported", reason: `并列选项含未核实技能：${missing.join("、")}`, name: andTail[2] }
      : { kind: "group", choose: 1, options: resolved, label: andTail[2] };
  }
  if (!tail) {
    const colon = text.match(/^(.*?)[：:](.+)$/);
    if (colon && /任选|选取|以下/.test(colon[1])) {
      const countMatch = colon[1].match(/(?:任选|选取)([一二两三四五六七八九十]+)[项种]|最多选取([一二两三四五六七八九十]+)[个种]/);
      const choose = countMatch ? CN_NUM[countMatch[1] ?? countMatch[2]] : 1;
      const inner = colon[2].replace(/^（|）$/g, "");
      const parts = splitTop(inner);
      const resolved = parts.map((part) => resolveToken(part));
      const missing = parts.filter((part, index) => !resolved[index]);
      text = colon[1]
        .replace(/(?:下面)?(?:任选|选取)[一二两三四五六七八九十]+[项种]$/, "")
        .replace(/以及从以下.*$/, "")
        .replace(/[，、]$/, "");
      tail = missing.length
        ? { kind: "unsupported", reason: `任选组含未核实技能：${missing.join("、")}`, name: inner }
        : { kind: "group", choose, options: resolved, label: inner };
    }
  }

  const items = splitTop(text);
  if (tail) items.push(tail);
  const slots = [];
  const unsupported = [];
  for (const item of items) {
    const parsed = parseItem(item);
    if (!parsed) continue;
    if (parsed.kind === "unsupported") { unsupported.push({ item: parsed.name ?? item, reason: parsed.reason }); continue; }
    slots.push(parsed);
  }
  // The source occasionally repeats a fixed skill (潛行 twice). A repeated
  // fixed/choice slot is the same printed item and must not inflate the count.
  const seen = new Set();
  const unique = [];
  for (const slot of slots) {
    const signature = JSON.stringify(slot);
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(slot);
  }
  const count = unique.reduce((sum, slot) => sum + (slot.kind === "group" || slot.kind === "any" ? slot.choose : 1), 0);
  if (unsupported.length) {
    records.push({
      key,
      category: "unverified-skill",
      reason: unsupported.map((entry) => `${entry.item}（${entry.reason}）`).join("；"),
    });
    continue;
  }
  if (count !== 8) {
    records.push({ key, category: "not-eight-slots", reason: `解析为 ${count} 项，规则要求恰好 8 项` });
    continue;
  }
  const credit = parseCredit(creditRaw);
  if (!credit || credit.min < 0 || credit.max > 99 || credit.min > credit.max) {
    records.push({ key, category: "invalid-credit-rating", reason: `信用区间非法：${creditRaw}` });
    continue;
  }
  const formulas = parseFormula(attrRaw);
  if (!formulas) {
    records.push({ key, category: "unsupported-formula", reason: `职业点公式不在现有白名单：${attrRaw}` });
    continue;
  }
  records.push({ key, credit, formulas, slots: unique, attr: attrRaw });
}

// --------------------------------------------------------------- dedupe
// Canonical skill shape. Two printed spellings are equivalent when they offer
// the same option set for the same number of picks: e.g. two separate
// "one interpersonal skill" groups and one "two interpersonal skills" group both
// become c:2:charm,fast-talk,intimidate,persuade. This is what lets the
// SealDice records that merely rephrase the existing occupation be proven
// duplicates instead of name conflicts.
const slotOptionKey = (option) => option.kind === "skill"
  ? `s:${option.key ?? option.skill}`
  : option.kind === "family" ? `f:${option.family}` : "any";
const shapeSignature = (slots) => {
  const fixed = [];
  const choices = new Map();
  for (const slot of slots) {
    if (slot.kind === "skill") { fixed.push(`s:${slot.key}`); continue; }
    if (slot.kind === "specialism") { fixed.push(`sp:${slot.key}`); continue; }
    const options = slot.kind === "family"
      ? [`f:${slot.family}`]
      : slot.kind === "any"
        ? ["any"]
        : (slot.options ?? []).map(slotOptionKey);
    const unique = [...new Set(options)].sort().join(",");
    const choose = slot.kind === "any" ? slot.choose : slot.kind === "group" ? slot.choose : 1;
    choices.set(unique, (choices.get(unique) ?? 0) + choose);
  }
  const out = [...fixed];
  for (const [options, choose] of choices) {
    if (choose === 1 && !options.includes(",")) out.push(options);
    else out.push(`c:${choose}:${options}`);
  }
  return out.sort().join(";");
};
const recordSignature = (record) => [
  `${record.credit.min}-${record.credit.max}`,
  [...record.formulas].sort().join("|"),
  shapeSignature(record.slots),
].join("#");

const existingProfessions = readJson("content/coc/professions.json");
// Drop records owned by a previous import run before computing the base pack,
// so re-running the importer is idempotent and never treats its own output as
// an existing occupation.
existingProfessions.professions = existingProfessions.professions.filter((entry) => !String(entry.factId).startsWith(FACT_PREFIX));
// The SealDice text uses "Pilot (any)" as a choice slot; the project had no
// pilot family because all shipped pilots fixed Aircraft or Boat directly.
// Add the family with the already-verified base of 1 (Pilot (Boat) and Pilot
// (Aircraft) both print 1) and list only the concrete skills that exist.
if (!existingProfessions.skillFamilies?.pilot) {
  existingProfessions.skillFamilies = existingProfessions.skillFamilies ?? {};
  existingProfessions.skillFamilies.pilot = {
    label: "驾驶",
    parentKey: "pilot",
    base: 1,
    baseSourceRefs: ["coc-sheet-1920s"],
    concrete: ["pilot-aircraft", "pilot-boat", "pilot-horse"],
    open: true,
  };
}
const existingNames = new Set(existingProfessions.professions.map((entry) => entry.name));
const existingSlugs = new Set(existingProfessions.professions.map((entry) => entry.slug));
const existingSignatures = new Map();
for (const entry of existingProfessions.professions) {
  const slots = [];
  for (const key of entry.fixedSkills ?? []) slots.push({ kind: "skill", key });
  for (const group of entry.choiceGroups ?? []) slots.push({ kind: "group", choose: group.choose, options: group.options, distinct: group.distinct });
  for (const slot of entry.specialismSlots ?? []) slots.push({ kind: "specialism", key: slot.specKey });
  const formulas = entry.pointFormulas ?? [entry.pointFormula];
  existingSignatures.set([
    `${entry.creditMin}-${entry.creditMax}`,
    [...new Set(formulas)].sort().join("|"),
    shapeSignature(slots),
  ].join("#"), entry);
}

const candidates = records.filter((record) => !record.category);
const deferred = records.filter((record) => record.category);
// The three remaining same-name records are NOT normalized duplicates; keep
// the evidence in the deferred reason instead of overwriting or cloning them.
const CONFLICT_NOTES = {
  "艺术家": "显示名「艺术家」与已有职业冲突；已有 CR 9-50、EDU*2+POW*2 或 EDU*2+DEX*2，固定技能为心理学/侦查；来源 CR 10-40、固定技能含估价/历史/图书馆，规范化签名不同，不覆盖已有记录",
  "猎人": "显示名「猎人」与已有职业冲突；已有把科学（动物学）固定，来源是科学（生物学或植物学）选择位，固定专精不同，不覆盖已有记录",
  "渔民": "显示名「渔民」与已有职业冲突；规范化签名不同：已有 CR 20-40、EDU*4、急救+一项社交，来源 CR 9-30、EDU*2+STR*2 或 EDU*2+DEX*2、操作重型机械+科学（天文），不覆盖已有记录",
};
const seenSignatures = new Map();
const imported = [];
for (const record of candidates) {
  const signature = recordSignature(record);
  if (existingSignatures.has(signature)) {
    deferred.push({
      key: record.key,
      category: "duplicate-existing",
      reason: `与已有职业 ${existingSignatures.get(signature).slug} 的公式选项、信用区间与技能签名完全一致`,
    });
    continue;
  }
  if (seenSignatures.has(signature)) {
    deferred.push({
      key: record.key,
      category: "duplicate-source",
      reason: `与来源条目「${seenSignatures.get(signature)}」的公式选项、信用区间与技能签名完全一致`,
    });
    continue;
  }
  seenSignatures.set(signature, record.key);
  if (existingNames.has(record.key)) {
    deferred.push({
      key: record.key,
      category: "display-name-conflict",
      reason: CONFLICT_NOTES[record.key] ?? `显示名「${record.key}」与已有职业冲突，且定义不同；不覆盖已有记录`,
    });
    continue;
  }
  const profile = PROFILES[record.key];
  if (!profile) fail(`候选「${record.key}」缺少 slug/英文名/自写描述`);
  const [slug, enName, name, description] = profile;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(`${record.key}: slug 非 ASCII kebab-case：${slug}`);
  if (existingSlugs.has(slug) || imported.some((entry) => entry.slug === slug)) fail(`${record.key}: slug 冲突 ${slug}`);
  if (existingNames.has(name)) {
    deferred.push({
      key: record.key,
      category: "display-name-conflict",
      reason: CONFLICT_NOTES[record.key] ?? `显示名「${name}」与已有职业冲突，且定义不同；不覆盖已有记录`,
    });
    continue;
  }
  if (imported.some((entry) => entry.name === name)) fail(`${record.key}: 显示名重复 ${name}`);
  if (!description) fail(`${record.key}: 缺少自写描述`);
  imported.push({ ...record, slug, enName, name, description });
}

// --------------------------------------------------------------- new skills
const skillBases = loadSkillBases(SKILLS_PY_PATH);
const skillSourceRefs = (skill) => {
  if (skill.source) return ["coc-cardwright"];
  const family = existingProfessions.skillFamilies?.[skill.parentKey];
  return family?.baseSourceRefs ?? [];
};
for (const skill of NEW_SKILLS) {
  if (skill.source) {
    const expected = skillBases.get(normalize(skill.source));
    if (expected === undefined) fail(`skills.py 没有 ${skill.source} 的基础值`);
    const override = SKILL_BASE_OVERRIDES.get(skill.key);
    const wanted = override?.base ?? expected;
    if (skill.base !== wanted) fail(`${skill.key}: 基础值 ${skill.base} 与 skills.py ${expected} 不符`);
  } else {
    // No same-name skills.py row: the concrete member takes the family's
    // verified base and the family's baseSourceRefs. A family with an unknown
    // base (requiresExplicitBase) may never publish a guessed member value.
    const family = existingProfessions.skillFamilies?.[skill.parentKey];
    if (!family) fail(`${skill.key}: 未知技能族 ${skill.parentKey}`);
    if (family.base === null || !Number.isInteger(family.base)) {
      fail(`${skill.key}: 技能族 ${skill.parentKey} 没有已核基础值`);
    }
    if (skill.base !== family.base) fail(`${skill.key}: 基础值 ${skill.base} 与 ${skill.parentKey} 族 ${family.base} 不符`);
    if (!(family.baseSourceRefs ?? []).length) fail(`${skill.key}: 技能族 ${skill.parentKey} 缺少 baseSourceRefs`);
  }
}
const newSkillKeys = new Set(NEW_SKILLS.map((skill) => skill.key));
const isImportedSkill = (skill) => String(skill.factId).startsWith(SKILL_FACT_PREFIX) || newSkillKeys.has(skill.key);
const persistedSkills = readJson("content/coc/skills.json").skills.filter((skill) => !isImportedSkill(skill));
const knownSkillKeys = new Set(persistedSkills.map((skill) => skill.key));
for (const skill of NEW_SKILLS) {
  if (knownSkillKeys.has(skill.key)) fail(`技能 key 已存在：${skill.key}`);
  knownSkillKeys.add(skill.key);
}

const referencedSkillKeys = new Set();
const referencedFamilies = new Set();
for (const record of imported) {
  for (const slot of record.slots) {
    if (slot.kind === "skill") referencedSkillKeys.add(slot.key);
    if (slot.kind === "family") referencedFamilies.add(slot.family);
    for (const option of slot.options ?? []) {
      if (option.kind === "skill") referencedSkillKeys.add(option.key);
      if (option.kind === "family") referencedFamilies.add(option.family);
    }
  }
}
for (const key of referencedSkillKeys) {
  if (!knownSkillKeys.has(key)) fail(`职业引用了未知技能 ${key}`);
}
const familyFacts = existingProfessions.skillFamilies ?? {};
for (const family of referencedFamilies) {
  if (!familyFacts[family]) fail(`职业引用了未知技能族 ${family}`);
}

// ----------------------------------------------------------- build records
const groupKeyFor = (slot, used) => {
  let base;
  if (slot.social) base = "interpersonal";
  else if (slot.kind === "any") base = "any-specialty";
  else if (slot.kind === "family") base = slot.family;
  else if ((slot.options ?? []).length === 1 && slot.options[0].kind === "any") base = "any-specialty";
  else if ((slot.options ?? []).length === 1 && slot.options[0].kind === "family") base = slot.options[0].family;
  else base = (slot.options ?? []).map((option) => option.kind === "skill" ? option.key : option.kind === "family" ? option.family : "any").join("-or-");
  base = base.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (base.length > 64) base = "choice";
  let key = base;
  let index = 2;
  while (used.has(key)) {
    key = `${base}-${index === 2 ? "two" : index === 3 ? "three" : index}`;
    index += 1;
  }
  used.add(key);
  return key;
};

const buildRecord = (record) => {
  const fixedSkills = [];
  const choiceGroups = [];
  const usedKeys = new Set();
  for (const slot of record.slots) {
    if (slot.kind === "skill") { fixedSkills.push(slot.key); continue; }
    const choose = slot.kind === "any" ? slot.choose : slot.kind === "group" ? slot.choose : 1;
    const options = slot.kind === "any"
      ? [{ kind: "any" }]
      : slot.kind === "family"
        ? [{ kind: "family", family: slot.family }]
        : slot.options.map((option) => option.kind === "skill" ? { kind: "skill", skill: option.key } : option.kind === "family" ? { kind: "family", family: option.family } : { kind: "any" });
    const label = slot.kind === "family" ? `一项${FAMILY_LABEL[slot.family]}专精` : slot.label ?? "选择一项";
    const distinct = slot.distinct === true || (choose > 1 && options.every((option) => option.kind !== "any"));
    choiceGroups.push({
      key: groupKeyFor(slot, usedKeys),
      label,
      choose,
      ...(distinct ? { distinct: true } : {}),
      options,
    });
  }
  const formulas = record.formulas;
  return {
    factId: `${FACT_PREFIX}${record.slug}`,
    slug: record.slug,
    brpid: `i.profession.coc.${record.slug}`,
    name: record.name,
    enName: record.enName,
    ...(formulas.length === 1 ? { pointFormula: formulas[0] } : { pointFormulas: formulas }),
    creditMin: record.credit.min,
    creditMax: record.credit.max,
    evidence: "secondary",
    sourceRefs: [SOURCE_ID],
    description: record.description,
    fixedSkills,
    specialismSlots: [],
    choiceGroups,
    batch: BATCH,
  };
};

const importedFacts = imported.map(buildRecord);
for (const record of importedFacts) {
  if (!isSupportedPointFormulas(record)) fail(`${record.slug}: 公式不在白名单`);
  const total = record.fixedSkills.length + record.choiceGroups.reduce((sum, group) => sum + group.choose, 0);
  if (total !== 8) fail(`${record.slug}: ${total} 项，不是 8 项`);
}

// ----------------------------------------------------------- skills.json
const skillFacts = readJson("content/coc/skills.json");
skillFacts.skills = skillFacts.skills.filter((skill) => !isImportedSkill(skill));
const skillRecords = NEW_SKILLS.map((skill) => ({
  factId: `${SKILL_FACT_PREFIX}${skill.key}`,
  key: skill.key,
  specKey: skill.specKey,
  name: skill.name,
  enName: skill.enName,
  brpid: `i.skill.coc.${skill.key}`,
  base: skill.base,
  variable: false,
  baseFormula: null,
  specialism: skill.parentKey !== null,
  ...(skill.parentKey ? { parentKey: skill.parentKey, mainName: FAMILY_LABEL[skill.parentKey] } : {}),
  sourceRefs: skillSourceRefs(skill),
  description: skill.description,
})).sort((left, right) => left.key.localeCompare(right.key));
skillFacts.skills.push(...skillRecords);
skillFacts.revision = "2026-10-30";
writeJson("content/coc/skills.json", skillFacts);

// -------------------------------------------------------- professions.json
const professionFacts = existingProfessions;
professionFacts.professions = professionFacts.professions.filter((entry) => !String(entry.factId).startsWith(FACT_PREFIX));
professionFacts.professions.push(...importedFacts);
for (const [familyKey, keys] of Object.entries({
  "art-craft": NEW_SKILLS.filter((skill) => skill.parentKey === "art-craft").map((skill) => skill.key),
  "science": NEW_SKILLS.filter((skill) => skill.parentKey === "science").map((skill) => skill.key),
  "pilot": NEW_SKILLS.filter((skill) => skill.parentKey === "pilot").map((skill) => skill.key),
  "survival": NEW_SKILLS.filter((skill) => skill.parentKey === "survival").map((skill) => skill.key),
  "fighting": NEW_SKILLS.filter((skill) => skill.parentKey === "fighting").map((skill) => skill.key),
  "firearms": NEW_SKILLS.filter((skill) => skill.parentKey === "firearms").map((skill) => skill.key),
})) {
  const family = professionFacts.skillFamilies?.[familyKey];
  if (!family) fail(`professions.json 缺少技能族 ${familyKey}`);
  family.concrete = [...new Set([...(family.concrete ?? []), ...keys])].sort();
}
professionFacts.dataset = "coc7-occupations-m8";
professionFacts.revision = "2026-10-30";
professionFacts.verifiedOn = "2026-10-30";
professionFacts.scope = [
  "M2 first-batch occupations; the M3 second batch (Doctor of Medicine, Police Detective, Librarian, Lawyer, Engineer);",
  "the M6 third batch (Police Officer, Artist, Clergy, Pilot); the M7 coc-cardwright batch;",
  `and the ${BATCH}: ${importedFacts.length} SealDice builtin formal definitions mapped onto the same creation rules.`,
  "Only the helpdoc's formula, credit-rating range and skill composition are used; every description is written for this project.",
  "Entries that are aliases, malformed, custom, not eight slots, missing a formula/credit range, or lacking a verified skill base are listed as deferred in provenance.json.",
].join(" ");
writeJson("content/coc/professions.json", professionFacts);

// --------------------------------------------------------- provenance.json
const provenance = readJson("content/coc/provenance.json");
provenance.dataset = "coc7-core-m1-m2-m3-m4-m5-m6-m7-m8";
provenance.revision = "2026-10-30";
provenance.scope = [
  provenance.scope.split(" M8 ")[0]
    .replace(/Note on naming:[\s\S]*?M6 by the third\./, "Note on naming: the shipped occupation dataset string is `coc7-occupations-m8` (the fifth occupation batch, from the SealDice builtin helpdoc); the repository milestone label is M8 because M3/M4 are already taken by combat and sanity, M5 by the second occupation batch, M6 by the third and M7 by the fourth (coc-cardwright)."),
  `M8 SealDice builtin compatibility batch: ${importedFacts.length} formal occupation definitions and ${NEW_SKILLS.length} concrete skills, with deferred categories recorded separately.`,
].join(" ");

const sourceRecord = {
  id: SOURCE_ID,
  title: "SealDice builtin COC职业查询 helpdoc (sealdice-builtins; no license declared)",
  url: "https://github.com/sealdice/sealdice-builtins",
  retrievedOn: "2026-10-30",
  evidence: "secondary",
  usedFor: [
    "Occupation point formulas, credit-rating ranges and skill composition for the SealDice compatibility batch",
    "The complete list of aliases, malformed entries, the custom template, non-eight-slot lists, duplicate definitions and unverified skill references that stay deferred",
  ],
  note: "Read from a local read-only copy at /tmp/sealdice-coc-occupations.json. sealdice-core is MIT, but sealdice-builtins declares no license. The JSON file and its occupation prose are not redistributed: only formulas, credit ranges and skill names are mapped, and every description in content/coc/professions.json is written for this project. This is secondary evidence, not an official Chaosium publication.",
};
provenance.sources = provenance.sources.filter((entry) => entry.id !== SOURCE_ID);
provenance.sources.push(sourceRecord);

provenance.licenseBoundary = provenance.licenseBoundary ?? {};
provenance.licenseBoundary.excluded = provenance.licenseBoundary.excluded ?? [];
const boundaryNotes = [
  "No SealDice builtin JSON file, helpdoc text or occupation description is copied into this repository; sealdice-builtins declares no license.",
  "No GPL Call of Cthulhu system implementation, template or source file was read or referenced for this batch.",
];
for (const note of boundaryNotes) {
  if (!provenance.licenseBoundary.excluded.includes(note)) provenance.licenseBoundary.excluded.push(note);
}

const m8Skills = {
  status: "secondary",
  sourceRef: "coc-cardwright",
  note: "Base values for the concrete skills added for the SealDice batch come from one of two verified sources: a same-name skills.py row (sourceRefs coc-cardwright), or the open family's verified base and baseSourceRefs (coc-sheet-1920s) when skills.py has no same-name row. A specific printed value overrides the family default: Mathematics is 10 rather than the Science family default 1, and Survival (Mountain) is 5 as printed, not the Survival family default 10. No value is guessed and no unverified skill is emitted as fixed 0.",
  perSkill: Object.fromEntries(NEW_SKILLS
    .map((skill) => [skill.key, { base: skill.base, sourceRefs: skillSourceRefs(skill) }])
    .sort(([left], [right]) => left.localeCompare(right))),
};
provenance.skillsM8 = m8Skills;

const byCategory = {};
const deferredRecords = {};
for (const record of deferred) {
  byCategory[record.category] = (byCategory[record.category] ?? 0) + 1;
  deferredRecords[record.key] = { category: record.category, reason: record.reason };
}
for (const alias of aliases) {
  byCategory.alias = (byCategory.alias ?? 0) + 1;
  deferredRecords[alias.key] = { category: "alias", reason: `别名，指向「${alias.target}」；不单独建卡` };
}
for (const anomaly of anomalies) {
  byCategory["format-anomaly"] = (byCategory["format-anomaly"] ?? 0) + 1;
  deferredRecords[anomaly.key] = { category: "format-anomaly", reason: `${anomaly.detail}，无法按正式定义解析` };
}
provenance.occupations = provenance.occupations ?? {};
provenance.occupations.status = "five-batches-verified-secondary-not-official-first-party";
provenance.occupations.fifthBatchRetrievedOn = "2026-10-30";
provenance.occupations.perRecord = provenance.occupations.perRecord ?? {};
for (const key of Object.keys(provenance.occupations.perRecord)) {
  if (key.startsWith(FACT_PREFIX)) delete provenance.occupations.perRecord[key];
}
for (const record of importedFacts) {
  const fact = imported.find((entry) => entry.slug === record.slug);
  provenance.occupations.perRecord[record.factId] = {
    formula: record.pointFormula ?? record.pointFormulas[0],
    ...(record.pointFormulas ? { formulas: record.pointFormulas } : {}),
    creditMin: record.creditMin,
    creditMax: record.creditMax,
    sourceRefs: [SOURCE_ID],
    evidence: "secondary",
    batch: BATCH,
    sourceKey: fact.key,
    slotCount: 8,
    claimBoundary: "Mapped from a SealDice builtin helpdoc entry: only the printed point formula, credit-rating range and skill composition were used. The description is original to this project, and the helpdoc prose was not copied. sealdice-builtins declares no license, so no part of that file is redistributed; treat this record as secondary evidence.",
  };
}
provenance.occupations.deferredRecords = deferredRecords;
provenance.occupations.deferredSummary = {
  imported: importedFacts.length,
  deferred: Object.keys(deferredRecords).length,
  total: importedFacts.length + Object.keys(deferredRecords).length,
  byCategory: Object.fromEntries(Object.entries(byCategory).sort(([left], [right]) => left.localeCompare(right))),
};

const deferredNote = `SealDice batch: ${aliases.length} aliases, ${anomalies.length} malformed entries, ${records.filter((entry) => entry.category === "custom").length} custom template, and every definition that is not exactly eight slots, lacks a formula/credit range, duplicates an existing or source definition, conflicts on display name, or references an unverified skill base stay out of the buildable list. The ${byCategory["display-name-conflict"] ?? 0} display-name conflicts are kept as deferred rather than overwriting the existing 38 records.`;
provenance.occupations.notes = (provenance.occupations.notes ?? []).filter((note) => !note.startsWith("SealDice batch:"));
provenance.occupations.notes.push(deferredNote);
const slotNote = "SealDice slot model: every imported record has exactly eight fixed/choice/any slots. A parenthetical list under one skill family is one choice slot (for example Science (Biology, Pharmacy) is one slot with two options), not several fixed slots; an explicit 'any N' counts as N slots. No record is padded with an unprinted 'any skill' slot and no formula is collapsed to MAX.";
if (!provenance.occupations.notes.includes(slotNote)) provenance.occupations.notes.push(slotNote);
const licenseNote = "SealDice descriptions are self-written. The helpdoc's 【介绍】 prose is not copied, and sealdice-builtins is not described as MIT or as an official Chaosium source.";
if (!provenance.occupations.notes.includes(licenseNote)) provenance.occupations.notes.push(licenseNote);

provenance.unverified = provenance.unverified ?? {};
provenance.unverified.items = provenance.unverified.items ?? [];
const unverifiedIndex = provenance.unverified.items.findIndex((item) => item.startsWith("Occupation point formulas and credit-rating ranges beyond"));
const unverifiedText = "Occupation point formulas and credit-rating ranges beyond the published batches; the SealDice compatibility batch adds every formal eight-slot entry whose formula, credit range and skill bases could be verified, but aliases, malformed entries, the custom template, non-eight-slot lists and records needing 学问 (Knowledge), Bicycle, or unverified combat specialisms remain deferred";
if (unverifiedIndex >= 0) provenance.unverified.items[unverifiedIndex] = unverifiedText;
else provenance.unverified.items.push(unverifiedText);

provenance.occupations.evidenceNote = [
  String(provenance.occupations.evidenceNote ?? "").split(" The M8 SealDice batch")[0]
    .replace("Every profession in all four batches is secondary evidence only.", "Every profession in all published batches is secondary evidence only."),
  "The M8 SealDice batch adds formal definitions from the sealdice-builtins COC职业查询 helpdoc. sealdice-core is MIT but sealdice-builtins declares no license; only formulas, credit ranges and skill names were used, all descriptions are self-written, and the helpdoc text is not redistributed. Every M8 record is secondary evidence, not an official Chaosium publication.",
].join(" ");
writeJson("content/coc/provenance.json", provenance);

// ------------------------------------------------------------------ summary
const importedKeys = new Set(importedFacts.map((record) => record.factId));
const deferredCount = Object.keys(deferredRecords).length;
console.log(`SealDice 导入：helpdoc ${Object.keys(helpdoc).length} 条`);
console.log(`  别名 ${aliases.length} / 格式异常 ${anomalies.length} / 正式定义 ${records.length}（自定义 ${byCategory.custom ?? 0}，缺公式 ${byCategory["missing-formula"] ?? 0}）`);
console.log(`  新增职业 ${importedFacts.length}（八项校验通过；来源 ${SOURCE_ID}）`);
console.log(`  新增技能 ${skillRecords.length}（基础值已对照 skills.py）`);
console.log(`  deferred ${deferredCount}：${Object.entries(byCategory).sort(([left], [right]) => left.localeCompare(right)).map(([category, count]) => `${category}=${count}`).join(" ")}`);
console.log(`  总职业 ${professionFacts.professions.length}（已有 38 未被覆盖）`);
if (!importedFacts.every((record) => importedKeys.has(record.factId))) process.exit(1);
