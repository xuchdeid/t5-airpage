'use strict';

/* ---------- protocol constants (must match src/bleimage.cpp) ---------- */
const SERVICE = '5f9b0001-7a6b-4c2d-9e8f-1234567890ab';
const CTRL    = '5f9b0002-7a6b-4c2d-9e8f-1234567890ab';
const DATA    = '5f9b0003-7a6b-4c2d-9e8f-1234567890ab';
const INFO    = '5f9b0004-7a6b-4c2d-9e8f-1234567890ab';
const PANEL_W = 122, PANEL_H = 250, STRIDE = 16;
const IMAGE_BYTES = STRIDE * PANEL_H;
const SCRIPT_MAX = 4096;
const CMD_BEGIN_SCRIPT = 0x10, CMD_COMMIT_SCRIPT = 0x12;
const CMD_RUN_SCRIPT = 0x13, CMD_ABORT_SCRIPT = 0x14;
let W = PANEL_W, H = PANEL_H;

const DEVICE_SCRIPT_DEFAULT = (window.T5Paper && T5Paper.samples.hello.code) ||
  'paper.clear(0);\npaper.text(6, 6, "AirPage", 1, 1);\npaper.commit();';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.style.color = kind === 'bad' ? 'var(--bad)' : kind === 'ok' ? 'var(--ok)' : '';
}
function setDot(state) {
  const d = $('#dot');
  d.className = 'dot' + (state === 'on' ? ' on' : state === 'busy' ? ' busy' : '');
}

/* ---------- state ---------- */
const jsSavedCode = (() => {
  try {
    let saved = localStorage.getItem('t5.device.js');
    if (saved === null) saved = localStorage.getItem('t5.device.code');
    // The old 24 px default was 358 B.  Do not carry its 24 px coordinates
    // into the 12 px editor; real custom scripts are left untouched.
    if (saved !== null && saved.indexOf('paper.text(M, 52') >= 0 &&
        new TextEncoder().encode(saved).length === 358) {
      saved = null;
      localStorage.removeItem('t5.device.js');
      localStorage.removeItem('t5.device.code');
    }
    if (saved !== null) return saved;
  } catch (e) {}
  return (window.T5Paper && T5Paper.samples.hello.code) || DEVICE_SCRIPT_DEFAULT;
})();
const jsSavedExample = (() => {
  const samples = (window.T5Paper && T5Paper.samples) || {};
  for (const id of Object.keys(samples)) {
    if (samples[id].code === jsSavedCode) return id;
  }
  return 'custom';
})();
const state = {
  template: 'daily',
  orientation: 'portrait',
  photo: null,
  caption: '',
  dither: 'fs',
  dailyDate: (() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })(),
  dailyOffset: 0,
  jsExample: jsSavedExample,
  jsCode: jsSavedCode,
};

/* ---------- canvases ---------- */
const preview = $('#preview');
const pctx = preview.getContext('2d', { willReadFrequently: true });
const base = document.createElement('canvas');
base.width = W; base.height = H;
let bctx = base.getContext('2d', { willReadFrequently: true });

/* ---------- pixel fonts ----------
 * 8/10/12 px: Fusion Pixel's three independent pixel designs.
 * 14-32 px Chinese: 24x24 ISCAS Song bitmap, scaled to the requested size.
 * 48 px Chinese: 2x24 Song for the large number/label slots.
 * Latin/numbers above 12 px stay on the 12 px master.
 * No system font and no anti-aliased Chinese in the final image.
 */
const glyphs = new Map();
let measureCtx = document.createElement('canvas').getContext('2d');
let fontReady = false;

/* 24x24 ISCAS Song bitmap, used for Chinese at 24 px and above. */
let songReady = false, songImg = null, songMeta = null;

/* Native 14/16 px WenQuanYi Bitmap Song atlases. These fill the sizes that
 * the 24 px Song grid cannot represent without scaling. */
const WQY_SIZES = [14, 16];
const wqyFonts = {};

/* 24 px and above are rendered live from a high-resolution Song outline and
 * thresholded per target size. This avoids nearest-neighbour downscaling of
 * the 24 px bitmap at 18/20/22 and avoids enlarging it at 26-48. The 24 px
 * ISCAS bitmap remains only as a fallback for glyphs outside the subset. */
const DETAIL_SIZES = [18, 20, 22, 24, 26, 28, 30, 32, 48];
let serifReady = false;
let sansReady = false;
let activeFont = 'serif';
const NOTO_CHARS = new Set(" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~¤§¨°±·×àáèéêìíòó÷ùúüāēěīōūǎǐǒǔǖǘǚǜˇˉΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψωЁАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяё—―‖‘’“”…‰′″※℃№ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ←↑→↓∈∏∑√∝∞∠∥∧∨∩∪∫∮∴∵∶∷∽≈≌≠≡≤≥≮≯⊙⊥⌒①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋■□▲△◆◇○◎●★☆♀♂　、。〃々〈〉《》「」『』【】〓〔〕〖〗ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ・ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩一丁七万丈三上下丌不与丐丑专且丕世丘丙业丛东丝丞丢两严丧丨个丫丬中丰串临丶丸丹为主丽举丿乃久乇么义之乌乍乎乏乐乒乓乔乖乘乙乜九乞也习乡书乩买乱乳乾了予争事二亍于亏云互亓五井亘亚些亟亠亡亢交亥亦产亨亩享京亭亮亲亳亵人亻亿什仁仂仃仄仅仆仇仉今介仍从仑仓仔仕他仗付仙仝仞仟仡代令以仨仪仫们仰仲仳仵件价任份仿企伉伊伍伎伏伐休众优伙会伛伞伟传伢伤伥伦伧伪伫伯估伲伴伶伸伺似伽佃但位低住佐佑体何佗佘余佚佛作佝佞佟你佣佤佥佧佩佬佯佰佳佴佶佻佼佾使侃侄侈侉例侍侏侑侔侗供依侠侣侥侦侧侨侩侪侬侮侯侵便促俄俅俊俎俏俐俑俗俘俚俜保俞俟信俣俦俨俩俪俭修俯俱俳俸俺俾倌倍倏倒倔倘候倚倜借倡倥倦倨倩倪倬倭倮债值倾偃假偈偌偎偏偕做停健偬偶偷偻偾偿傀傅傈傍傣傥傧储傩催傲傺傻像僖僚僦僧僬僭僮僳僵僻儆儇儋儒儡儿兀允元兄充兆先光克免兑兔兕兖党兜兢入全八公六兮兰共关兴兵其具典兹养兼兽冀冁冂内冈冉册再冒冕冖冗写军农冠冢冤冥冫冬冯冰冱冲决况冶冷冻冼冽净凄准凇凉凋凌减凑凛凝几凡凤凫凭凯凰凳凵凶凸凹出击凼函凿刀刁刂刃分切刈刊刍刎刑划刖列刘则刚创初删判刨利别刭刮到刳制刷券刹刺刻刽刿剀剁剂剃削剌前剐剑剔剖剜剞剡剥剧剩剪副割剽剿劁劂劈劐劓力劝办功加务劢劣动助努劫劬劭励劲劳劾势勃勇勉勋勐勒勖勘募勤勰勹勺勾勿匀包匆匈匍匏匐匕化北匙匚匝匠匡匣匦匪匮匹区医匾匿十千卅升午卉半华协卑卒卓单卖南博卜卞卟占卡卢卣卤卦卧卩卫卮卯印危即却卵卷卸卺卿厂厄厅历厉压厌厍厕厘厚厝原厢厣厥厦厨厩厮厶去县叁参又叉及友双反发叔取受变叙叛叟叠口古句另叨叩只叫召叭叮可台叱史右叵叶号司叹叻叼叽吁吃各吆合吉吊同名后吏吐向吒吓吕吖吗君吝吞吟吠吡吣否吧吨吩含听吭吮启吱吲吴吵吸吹吻吼吾呀呃呆呈告呋呐呒呓呔呕呖呗员呙呛呜呢呤呦周呱呲味呵呶呷呸呻呼命咀咂咄咆咋和咎咏咐咒咔咕咖咙咚咛咝咣咤咦咧咨咩咪咫咬咭咯咱咳咴咸咻咽咿哀品哂哄哆哇哈哉哌响哎哏哐哑哒哓哔哕哗哙哚哜哝哞哟哥哦哧哨哩哪哭哮哲哳哺哼哽哿唁唆唇唉唏唐唑唔唛唠唢唣唤唧唪唬售唯唰唱唳唷唼唾唿啁啃啄商啉啊啐啕啖啜啡啤啥啦啧啪啬啭啮啵啶啷啸啻啼啾喀喁喂喃善喇喈喉喊喋喏喑喔喘喙喜喝喟喧喱喳喵喷喹喻喽喾嗄嗅嗉嗌嗍嗑嗒嗓嗔嗖嗜嗝嗟嗡嗣嗤嗥嗦嗨嗪嗫嗬嗯嗲嗳嗵嗷嗽嗾嘀嘁嘈嘉嘌嘎嘏嘘嘛嘞嘟嘣嘤嘧嘬嘭嘱嘲嘴嘶嘹嘻嘿噌噍噎噔噗噘噙噜噢噤器噩噪噫噬噱噶噻噼嚅嚆嚎嚏嚓嚣嚯嚷嚼囊囔囗囚四囝回囟因囡团囤囫园困囱围囵囹固国图囿圃圄圆圈圉圊圜土圣在圩圪圬圭圮圯地圳圹场圻圾址坂均坊坌坍坎坏坐坑块坚坛坜坝坞坟坠坡坤坦坨坩坪坫坭坯坳坶坷坻坼垂垃垄垅垆型垌垒垓垛垠垡垢垣垤垦垧垩垫垭垮垲垴垸埂埃埋城埏埒埔埕埘埙埚埝域埠埤埭埯埴埸培基埽堀堂堆堇堋堍堑堕堙堞堠堡堤堪堰堵塄塌塍塑塔塘塞塥填塬塾墀墁境墅墉墒墓墙墚增墟墨墩墼壁壅壑壕壤士壬壮声壳壶壹夂处备复夏夔夕外夙多夜够夤夥大天太夫夭央夯失头夷夸夹夺夼奁奂奄奇奈奉奋奎奏契奔奕奖套奘奚奠奢奥女奴奶奸她好妁如妃妄妆妇妈妊妍妒妓妖妗妙妞妣妤妥妨妩妪妫妮妯妲妹妻妾姆姊始姐姑姒姓委姗姘姚姜姝姣姥姨姬姹姻姿威娃娄娅娆娇娈娉娌娑娓娘娜娟娠娣娥娩娱娲娴娶娼婀婆婉婊婕婚婢婧婪婴婵婶婷婺婿媒媚媛媪媲媳媵媸媾嫁嫂嫉嫌嫒嫔嫖嫘嫜嫠嫡嫣嫦嫩嫫嫱嬉嬖嬗嬲嬴嬷孀子孑孓孔孕字存孙孚孛孜孝孟孢季孤孥学孩孪孬孰孱孳孵孺孽宀宁它宄宅宇守安宋完宏宓宕宗官宙定宛宜宝实宠审客宣室宥宦宪宫宰害宴宵家宸容宽宾宿寂寄寅密寇富寐寒寓寝寞察寡寤寥寨寮寰寸对寺寻导寿封射将尉尊小少尔尕尖尘尚尜尝尢尤尥尧尬就尴尸尹尺尻尼尽尾尿局屁层居屈屉届屋屎屏屐屑展屙属屠屡屣履屦屮屯山屹屺屿岁岂岈岌岍岐岑岔岖岗岘岙岚岛岜岢岣岩岫岬岭岱岳岵岷岸岽岿峁峄峋峒峙峡峤峥峦峨峪峭峰峻崂崃崆崇崎崔崖崛崞崤崦崧崩崭崮崴崽崾嵇嵊嵋嵌嵘嵛嵝嵩嵫嵬嵯嵴嶂嶙嶝嶷巅巍巛川州巡巢工左巧巨巩巫差巯己已巳巴巷巽巾币市布帅帆师希帏帐帑帔帕帖帘帙帚帛帜帝带帧席帮帱帷常帻帼帽幂幄幅幌幔幕幛幞幡幢干平年并幸幺幻幼幽广庀庄庆庇床庋序庐庑库应底庖店庙庚府庞废庠庥度座庭庳庵庶康庸庹庾廉廊廑廒廓廖廛廨廪廴延廷建廾廿开弁异弃弄弈弊弋式弑弓引弗弘弛弟张弥弦弧弩弪弭弯弱弹强弼彀彐归当录彖彗彘彝彡形彤彦彩彪彬彭彰影彳彷役彻彼往征徂径待徇很徉徊律後徐徒徕得徘徙徜御徨循徭微徵德徼徽心忄必忆忉忌忍忏忐忑忒忖志忘忙忝忠忡忤忧忪快忭忮忱念忸忻忽忾忿怀态怂怃怄怅怆怊怍怎怏怒怔怕怖怙怛怜思怠怡急怦性怨怩怪怫怯怵总怼怿恁恂恃恋恍恐恒恕恙恚恝恢恣恤恧恨恩恪恫恬恭息恰恳恶恸恹恺恻恼恽恿悃悄悉悌悍悒悔悖悚悛悝悟悠患悦您悫悬悭悯悱悲悴悸悻悼情惆惊惋惑惕惘惚惜惝惟惠惦惧惨惩惫惬惭惮惯惰想惴惶惹惺愀愁愆愈愉愍愎意愕愚感愠愣愤愦愧愫愿慈慊慌慎慑慕慝慢慧慨慰慵慷憋憎憔憝憧憨憩憬憷憾懂懈懊懋懑懒懔懦懵懿戆戈戊戋戌戍戎戏成我戒戕或戗战戚戛戟戡戢戤戥截戬戮戳戴户戽戾房所扁扃扇扈扉手扌才扎扑扒打扔托扛扣扦执扩扪扫扬扭扮扯扰扳扶批扼找承技抄抉把抑抒抓投抖抗折抚抛抟抠抡抢护报抨披抬抱抵抹抻押抽抿拂拄担拆拇拈拉拊拌拍拎拐拒拓拔拖拗拘拙拚招拜拟拢拣拥拦拧拨择括拭拮拯拱拳拴拶拷拼拽拾拿持挂指挈按挎挑挖挚挛挝挞挟挠挡挢挣挤挥挨挪挫振挲挹挺挽捂捃捅捆捉捋捌捍捎捏捐捕捞损捡换捣捧捩捭据捱捶捷捺捻掀掂掇授掉掊掌掎掏掐排掖掘掠探掣接控推掩措掬掭掮掰掳掴掷掸掺掼掾揄揆揉揍揎描提插揖揞揠握揣揩揪揭揲援揶揸揽揿搀搁搂搅搋搌搏搐搓搔搛搜搞搠搡搦搪搬搭搴携搽搿摁摄摅摆摇摈摊摒摔摘摞摧摩摭摸摹摺撂撄撅撇撑撒撕撖撙撞撤撩撬播撮撰撵撷撸撺撼擀擂擅操擎擐擒擗擘擞擢擤擦攀攉攒攘攥攫攮支攴攵收攸改攻放政故效敉敌敏救敕敖教敛敝敞敢散敦敫敬数敲整敷文斋斌斐斑斓斗料斛斜斟斡斤斥斧斩斫断斯新方於施旁旃旄旅旆旋旌旎族旒旖旗无既日旦旧旨早旬旭旮旯旰旱时旷旺昀昂昃昆昊昌明昏易昔昕昙昝星映春昧昨昭是昱昴昵昶昼显晁晃晋晌晏晒晓晔晕晖晗晚晟晡晤晦晨普景晰晴晶晷智晾暂暄暇暌暑暖暗暝暧暨暮暴暹暾曙曛曜曝曦曩曰曲曳更曷曹曼曾替最月有朊朋服朐朔朕朗望朝期朦木未末本札术朱朴朵机朽杀杂权杆杈杉杌李杏材村杓杖杜杞束杠条来杨杩杪杭杯杰杲杳杵杷杼松板极构枇枉枋析枕林枘枚果枝枞枢枣枥枧枨枪枫枭枯枰枳枵架枷枸柁柃柄柏某柑柒染柔柘柙柚柜柝柞柠柢查柩柬柯柰柱柳柴柽柿栀栅标栈栉栊栋栌栎栏树栓栖栗栝校栩株栲栳样核根格栽栾桀桁桂桃桄桅框案桉桊桌桎桐桑桓桔桕桠桡桢档桤桥桦桧桨桩桫桴桶桷梁梃梅梆梏梓梗梢梦梧梨梭梯械梳梵检棂棉棋棍棒棕棘棚棠棣森棰棱棵棹棺棼椁椅椋植椎椐椒椟椠椤椭椰椴椹椽椿楂楔楗楚楝楞楠楣楦楫楮楱楷楸楹楼榀概榄榆榇榈榉榍榔榕榘榛榜榧榨榫榭榱榴榷榻槁槊槌槎槐槔槛槟槠槭槲槽槿樊樗樘樟模樨横樯樱樵樽樾橄橇橐橘橙橛橡橥橱橹橼檀檄檎檐檑檗檠檩檫檬欠次欢欣欤欧欲欷欹欺款歃歆歇歉歌歙止正此步武歧歪歹死歼殁殂殃殄殆殇殉殊残殍殒殓殖殚殛殡殪殳殴段殷殿毁毂毅毋母每毒毓比毕毖毗毙毛毡毪毫毯毳毵毹毽氅氆氇氍氏氐民氓气氕氖氘氙氚氛氟氡氢氤氦氧氨氩氪氮氯氰氲水氵永氽汀汁求汆汇汉汊汐汔汕汗汛汜汝汞江池污汤汨汩汪汰汲汴汶汹汽汾沁沂沃沅沆沈沉沌沏沐沓沔沙沛沟没沣沤沥沦沧沩沪沫沭沮沱沲河沸油治沼沽沾沿泄泅泉泊泌泐泓泔法泖泗泛泞泠泡波泣泥注泪泫泮泯泰泱泳泵泶泷泸泺泻泼泽泾洁洄洇洋洌洎洒洗洙洚洛洞津洧洪洫洮洱洲洳洵洹活洼洽派流浃浅浆浇浈浊测浍济浏浑浒浓浔浙浚浜浞浠浣浦浩浪浮浯浴海浸浼涂涅消涉涌涎涑涓涔涕涛涝涞涟涠涡涣涤润涧涨涩涪涫涮涯液涵涸涿淀淄淅淆淇淋淌淑淖淘淙淝淞淠淡淤淦淫淬淮深淳混淹添淼清渊渌渍渎渐渑渔渖渗渚渝渠渡渣渤渥温渫渭港渲渴游渺湃湄湍湎湓湔湖湘湛湟湫湮湾湿溃溅溆溉溏源溘溜溟溢溥溧溪溯溱溲溴溶溷溺溻溽滁滂滇滋滏滑滓滔滕滗滚滞滟滠满滢滤滥滦滨滩滴滹漂漆漉漏漓演漕漠漤漩漪漫漭漯漱漳漶漾潆潇潋潍潘潜潞潢潦潭潮潲潴潸潺潼澄澈澉澌澍澎澜澡澧澳澶澹激濂濉濑濒濞濠濡濮濯瀑瀚瀛瀣瀵瀹灌灏灞火灬灭灯灰灵灶灸灼灾灿炀炅炉炊炎炒炔炕炖炙炜炝炫炬炭炮炯炱炳炷炸点炻炼炽烀烁烂烃烈烊烘烙烛烟烤烦烧烨烩烫烬热烯烷烹烽焉焊焐焓焕焖焘焙焚焦焯焰焱然煅煊煌煎煜煞煤煦照煨煮煲煳煸煺煽熄熊熏熔熘熙熟熠熨熬熳熵熹燃燎燔燕燠燥燧燮燹爆爝爨爪爬爰爱爵父爷爸爹爻爽爿片版牌牍牒牖牙牛牝牟牡牢牦牧物牮牯牲牵特牺牾牿犀犁犄犊犋犍犏犒犟犬犭犯犰犴状犷犸犹狁狂狃狄狈狍狎狐狒狗狙狞狠狡狨狩独狭狮狯狰狱狲狳狴狷狸狺狻狼猁猃猊猎猓猕猖猗猛猜猝猞猡猢猥猩猪猫猬献猱猴猷猸猹猾猿獍獐獒獗獠獬獭獯獾玄率玉王玎玑玖玛玟玢玩玫玮环现玲玳玷玺玻珀珂珈珉珊珍珏珐珑珙珞珠珥珧珩班珲球琅理琉琊琏琐琚琛琢琥琦琨琪琬琮琰琳琴琵琶琼瑁瑕瑗瑙瑚瑛瑜瑞瑟瑭瑰瑶瑷瑾璀璁璃璇璋璎璐璜璞璧璨璩璺瓒瓜瓞瓠瓢瓣瓤瓦瓮瓯瓴瓶瓷瓿甄甍甏甑甓甘甙甚甜生甥用甩甫甬甭甯田由甲申电男甸町画甾畀畅畈畋界畎畏畔留畚畛畜略畦番畲畴畸畹畿疃疆疋疏疑疒疔疖疗疙疚疝疟疠疡疣疤疥疫疬疮疯疰疱疲疳疴疵疸疹疼疽疾痂痃痄病症痈痉痊痍痒痔痕痖痘痛痞痢痣痤痦痧痨痪痫痰痱痴痹痼痿瘀瘁瘃瘅瘊瘌瘐瘕瘗瘘瘙瘛瘟瘠瘢瘤瘥瘦瘩瘪瘫瘭瘰瘳瘴瘵瘸瘼瘾瘿癀癃癌癍癔癖癜癞癣癫癯癸登白百皂的皆皇皈皋皎皑皓皖皙皤皮皱皲皴皿盂盅盆盈益盍盎盏盐监盒盔盖盗盘盛盟盥目盯盱盲直相盹盼盾省眄眇眈眉看眍眙眚真眠眢眦眨眩眭眯眵眶眷眸眺眼着睁睃睇睐睑睚睛睡睢督睥睦睨睫睬睹睽睾睿瞀瞄瞅瞌瞍瞎瞑瞒瞟瞠瞢瞥瞧瞩瞪瞬瞰瞳瞵瞻瞽瞿矍矗矛矜矢矣知矧矩矫矬短矮石矶矸矽矾矿砀码砂砉砌砍砑砒研砖砗砘砚砜砝砟砣砥砦砧砩砬砭砰破砷砸砹砺砻砼砾础硅硇硌硎硐硒硕硖硗硝硪硫硬硭确硷硼碇碉碌碍碎碑碓碗碘碚碛碜碟碡碣碥碧碰碱碲碳碴碹碾磁磅磉磊磋磐磔磕磙磨磬磲磴磷磺礁礅礓礞礤礴示礻礼社祀祁祆祈祉祓祖祗祚祛祜祝神祟祠祢祥祧票祭祯祷祸祺禀禁禄禅禊福禚禧禳禹禺离禽禾秀私秃秆秉秋种科秒秕秘租秣秤秦秧秩秫秭积称秸移秽稀稂稃稆程稍税稔稗稚稞稠稣稳稷稹稻稼稽稿穆穑穗穰穴究穷穸穹空穿窀突窃窄窆窈窍窑窒窕窖窗窘窜窝窟窠窥窦窨窬窭窳窿立竖站竞竟章竣童竦竭端竹竺竽竿笃笄笆笈笊笋笏笑笔笕笙笛笞笠笤笥符笨笪笫第笮笱笳笸笺笼笾筅筇等筋筌筏筐筑筒答策筘筚筛筝筠筢筮筱筲筵筷筹筻签简箅箍箐箔箕算箜箝管箢箦箧箨箩箪箫箬箭箱箴箸篁篆篇篌篑篓篙篚篝篡篥篦篪篮篱篷篼篾簇簋簌簏簖簟簦簧簪簸簿籀籁籍米籴类籼籽粉粑粒粕粗粘粜粝粞粟粢粤粥粪粮粱粲粳粹粼粽精糁糅糇糈糊糌糍糕糖糗糙糜糟糠糨糯糸系紊素索紧紫累絮絷綦綮縻繁繇纂纛纟纠纡红纣纤纥约级纨纩纪纫纬纭纯纰纱纲纳纵纶纷纸纹纺纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绐绑绒结绔绕绗绘给绚绛络绝绞统绠绡绢绣绥绦继绨绩绪绫续绮绯绰绱绲绳维绵绶绷绸绺绻综绽绾绿缀缁缂缃缄缅缆缇缈缉缋缌缍缎缏缑缒缓缔缕编缗缘缙缚缛缜缝缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵缶缸缺罂罄罅罐网罔罕罗罘罚罟罡罢罨罩罪置罱署罴罹罾羁羊羌美羔羚羝羞羟羡群羧羯羰羲羸羹羼羽羿翁翅翊翌翎翔翕翘翟翠翡翥翦翩翮翰翱翳翻翼耀老考耄者耆耋而耍耐耒耔耕耖耗耘耙耜耠耢耥耦耧耨耩耪耱耳耵耶耷耸耻耽耿聂聃聆聊聋职聍聒联聘聚聩聪聱聿肀肃肄肆肇肉肋肌肓肖肘肚肛肜肝肟肠股肢肤肥肩肪肫肭肮肯肱育肴肷肺肼肽肾肿胀胁胂胃胄胆背胍胎胖胗胙胚胛胜胝胞胡胤胥胧胨胩胪胫胬胭胯胰胱胲胳胴胶胸胺胼能脂脆脉脊脍脎脏脐脑脒脓脔脖脘脚脞脬脯脱脲脶脸脾腆腈腊腋腌腐腑腓腔腕腙腚腠腥腧腩腭腮腰腱腴腹腺腻腼腽腾腿膀膂膈膊膏膑膘膛膜膝膣膦膨膪膳膺膻臀臁臂臃臆臊臌臣臧自臬臭至致臻臼臾舀舁舂舄舅舆舌舍舐舒舔舛舜舞舟舡舢舣舨航舫般舭舯舰舱舳舴舵舶舷舸船舻舾艄艇艉艋艏艘艚艟艨艮良艰色艳艴艹艺艽艾艿节芄芈芊芋芍芎芏芑芒芗芘芙芜芝芟芡芤芥芦芨芩芪芫芬芭芮芯芰花芳芴芷芸芹芽芾苁苄苇苈苊苋苌苍苎苏苑苒苓苔苕苗苘苛苜苞苟苠苡苣苤若苦苫苯英苴苷苹苻茁茂范茄茅茆茇茈茉茌茎茏茑茔茕茗茚茛茜茧茨茫茬茭茯茱茳茴茵茶茸茹茺茼荀荃荆荇草荏荐荑荒荔荚荛荜荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药荷荸荻荼荽莅莆莉莎莒莓莘莛莜莞莠莨莩莪莫莰莱莲莳莴莶获莸莹莺莼莽菀菁菅菇菊菌菏菔菖菘菜菝菟菠菡菥菩菪菰菱菲菸菹菽萁萃萄萆萋萌萍萎萏萑萘萜萝萤营萦萧萨萱萸萼落葆葑著葙葚葛葜葡董葩葫葬葭葱葳葵葶葸葺蒂蒇蒈蒉蒋蒌蒎蒗蒙蒜蒡蒯蒲蒴蒸蒹蒺蒽蒿蓁蓄蓉蓊蓍蓐蓑蓓蓖蓝蓟蓠蓣蓥蓦蓬蓰蓼蓿蔌蔑蔓蔗蔚蔟蔡蔫蔬蔷蔸蔹蔺蔻蔼蔽蕃蕈蕉蕊蕖蕙蕞蕤蕨蕲蕴蕹蕺蕻蕾薄薅薇薏薛薜薤薨薪薮薯薰薷薹藁藉藏藐藓藕藜藤藩藻藿蘅蘑蘖蘧蘩蘸蘼虍虎虏虐虑虔虚虞虢虫虬虮虱虹虺虻虼虽虾虿蚀蚁蚂蚊蚋蚌蚍蚓蚕蚜蚝蚣蚤蚧蚨蚩蚪蚬蚯蚰蚱蚴蚵蚶蚺蛀蛄蛆蛇蛉蛊蛋蛎蛏蛐蛑蛔蛘蛙蛛蛞蛟蛤蛩蛭蛮蛰蛱蛲蛳蛴蛸蛹蛾蜀蜂蜃蜇蜈蜉蜊蜍蜒蜓蜕蜗蜘蜚蜜蜞蜡蜢蜣蜥蜩蜮蜱蜴蜷蜻蜾蜿蝇蝈蝉蝌蝎蝓蝗蝙蝠蝣蝤蝥蝮蝰蝴蝶蝻蝼蝽蝾螂螃螅螈螋融螓螗螟螨螫螬螭螯螳螵螺螽蟀蟆蟊蟋蟑蟒蟓蟛蟠蟥蟪蟮蟹蟾蠃蠊蠓蠕蠖蠛蠡蠢蠲蠹蠼血衄衅行衍衔街衙衡衢衣衤补表衩衫衬衮衰衲衷衽衾衿袁袂袄袅袈袋袍袒袖袜袢袤被袭袱袷袼裁裂装裆裉裎裒裔裕裘裙裟裢裣裤裥裨裰裱裳裴裸裹裼裾褂褊褐褒褓褙褚褛褡褥褪褫褰褴褶襁襄襞襟襦襻西要覃覆见观规觅视觇览觉觊觋觌觎觏觐觑角觖觚觜觞解觥触觫觯觳言訇訾詈詹誉誊誓謇謦警譬讠计订讣认讥讦讧讨让讪讫训议讯记讲讳讴讵讶讷许讹论讼讽设访诀证诂诃评诅识诈诉诊诋诌词诎诏译诒诓诔试诖诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谇谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谶谷豁豆豇豉豌豕豚象豢豪豫豳豸豹豺貂貅貉貊貌貔貘贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赓赔赕赖赘赙赚赛赜赝赞赠赡赢赣赤赦赧赫赭走赳赴赵赶起趁趄超越趋趑趔趟趣趱足趴趵趸趺趼趾趿跃跄跆跋跌跎跏跑跖跗跚跛距跞跟跣跤跨跪跫跬路跳践跷跸跹跺跻跽踅踉踊踌踏踔踝踞踟踢踣踩踪踬踮踯踱踵踹踺踽蹀蹁蹂蹄蹇蹈蹉蹊蹋蹑蹒蹙蹦蹩蹬蹭蹯蹰蹲蹴蹶蹼蹿躁躅躇躏躐躔躜躞身躬躯躲躺軎车轧轨轩轫转轭轮软轰轱轲轳轴轵轶轷轸轹轺轻轼载轾轿辁辂较辄辅辆辇辈辉辊辋辍辎辏辐辑输辔辕辖辗辘辙辚辛辜辞辟辣辨辩辫辰辱辶边辽达迁迂迄迅过迈迎运近迓返迕还这进远违连迟迢迤迥迦迨迩迪迫迭迮述迳迷迸迹追退送适逃逄逅逆选逊逋逍透逐逑递途逖逗通逛逝逞速造逡逢逦逭逮逯逵逶逸逻逼逾遁遂遄遇遍遏遐遑遒道遗遘遛遢遣遥遨遭遮遴遵遽避邀邂邃邈邋邑邓邕邗邙邛邝邡邢那邦邪邬邮邯邰邱邳邴邵邶邸邹邺邻邾郁郄郅郇郊郎郏郐郑郓郗郛郜郝郡郢郦郧部郫郭郯郴郸都郾鄂鄄鄙鄞鄢鄣鄯鄱鄹酃酆酉酊酋酌配酎酏酐酒酗酚酝酞酡酢酣酤酥酩酪酬酮酯酰酱酲酴酵酶酷酸酹酽酾酿醅醇醉醋醌醍醐醑醒醚醛醢醣醪醭醮醯醴醵醺采釉释里重野量金釜鉴銎銮鋈錾鍪鎏鏊鏖鐾鑫钅钆钇针钉钊钋钌钍钎钏钐钒钓钔钕钗钙钚钛钜钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铌铍铎铐铑铒铕铖铗铘铙铛铜铝铞铟铠铡铢铣铤铥铧铨铩铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铼铽链铿销锁锂锃锄锅锆锇锈锉锊锋锌锍锎锏锐锑锒锓锔锕锖锗锘错锚锛锝锞锟锡锢锣锤锥锦锨锩锪锫锬锭键锯锰锱锲锴锵锶锷锸锹锺锻锼锾锿镀镁镂镄镅镆镇镉镊镌镍镎镏镐镑镒镓镔镖镗镘镙镛镜镝镞镟镡镢镣镤镥镦镧镨镩镪镫镬镭镯镰镱镲镳镶长门闩闪闫闭问闯闰闱闲闳间闵闶闷闸闹闺闻闼闽闾阀阁阂阃阄阅阆阈阉阊阋阌阍阎阏阐阑阒阔阕阖阗阙阚阜阝队阡阢阪阮阱防阳阴阵阶阻阼阽阿陀陂附际陆陇陈陉陋陌降限陔陕陛陟陡院除陧陨险陪陬陲陴陵陶陷隅隆隈隋隍随隐隔隗隘隙障隧隰隳隶隹隼隽难雀雁雄雅集雇雉雌雍雎雏雒雕雠雨雩雪雯雳零雷雹雾需霁霄霆震霈霉霍霎霏霓霖霜霞霪霭霰露霸霹霾青靓靖静靛非靠靡面靥革靳靴靶靼鞅鞋鞍鞑鞒鞔鞘鞠鞣鞫鞭鞯鞲鞴韦韧韩韪韫韬韭音韵韶页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颌颍颏颐频颓颔颖颗题颚颛颜额颞颟颠颡颢颤颥颦颧风飑飒飓飕飘飙飚飞食飧飨餍餐餮饔饕饣饥饧饨饩饪饫饬饭饮饯饰饱饲饴饵饶饷饺饼饽饿馀馁馄馅馆馇馈馊馋馍馏馐馑馒馓馔馕首馗馘香馥馨马驭驮驯驰驱驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骄骅骆骇骈骊骋验骏骐骑骒骓骖骗骘骚骛骜骝骞骟骠骡骢骣骤骥骧骨骰骱骶骷骸骺骼髀髁髂髅髋髌髑髓高髟髡髦髫髭髯髹髻鬃鬈鬏鬓鬟鬣鬯鬲鬻鬼魁魂魃魄魅魇魈魉魍魏魑魔鱼鱿鲁鲂鲅鲆鲇鲈鲋鲍鲎鲐鲑鲒鲔鲕鲚鲛鲜鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲸鲺鲻鲼鲽鳃鳄鳅鳆鳇鳊鳋鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳘鳙鳜鳝鳞鳟鳢鸟鸠鸡鸢鸣鸥鸦鸨鸩鸪鸫鸬鸭鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹎鹏鹑鹕鹗鹘鹚鹛鹜鹞鹣鹤鹦鹧鹨鹩鹪鹫鹬鹭鹰鹱鹳鹾鹿麂麇麈麋麒麓麝麟麦麴麸麻麽麾黄黉黍黎黏黑黔默黛黜黝黟黠黢黥黧黩黪黯黹黻黼黾鼋鼍鼎鼐鼓鼗鼙鼠鼢鼬鼯鼷鼹鼻鼽鼾齄齐齑齿龀龃龄龅龆龇龈龉龊龋龌龙龚龛龟龠！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～￠￡￣￥");

const PIXEL_FACES = {
  8:  { family: 'T5Pixel8',  file: 'fonts/fusion-pixel-8px.woff2' },
  10: { family: 'T5Pixel10', file: 'fonts/fusion-pixel-10px.woff2' },
  12: { family: 'T5Pixel',   file: 'fonts/fusion-pixel-12px.woff2' }
};

async function loadPixelFont() {
  for (const [size, spec] of Object.entries(PIXEL_FACES)) {
    const face = new FontFace(spec.family, 'url("' + spec.file + '")');
    await face.load();
    document.fonts.add(face);
    await document.fonts.load(size + 'px ' + spec.family);
  }
  measureCtx.font = '12px ' + PIXEL_FACES[12].family;
  fontReady = true;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed: ' + src));
    img.src = src;
  });
}

async function loadSongFont() {
  const [img, meta] = await Promise.all([
    loadImage('fonts/song24.png'),
    fetch('fonts/song24.json').then(r => r.json())
  ]);
  songImg = img; songMeta = meta; songReady = true;
}

async function loadWqyFont(size) {
  const [img, meta] = await Promise.all([
    loadImage('fonts/wqy' + size + '.png'),
    fetch('fonts/wqy' + size + '.json').then(r => r.json())
  ]);
  wqyFonts[size] = { img, meta };
}

async function loadWqyFonts() {
  const results = await Promise.allSettled(WQY_SIZES.map(loadWqyFont));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn('WQY ' + WQY_SIZES[i] + 'px unavailable', r.reason);
  });
}

async function loadSerifFont() {
  const face = new FontFace('T5Serif', 'url("fonts/noto-serif-sc.woff2")');
  await face.load();
  document.fonts.add(face);
  await document.fonts.load('20px T5Serif');
  serifReady = true;

  try {
    const sans = new FontFace('T5Sans', 'url("fonts/noto-sans-sc.woff2")');
    await sans.load();
    document.fonts.add(sans);
    await document.fonts.load('20px T5Sans');
    sansReady = true;
  } catch (e) {
    console.warn('Noto Sans unavailable; font menu keeps serif', e);
    sansReady = false;
  }
}

function isSongChar(ch) {
  const cp = ch.codePointAt(0);
  return cp >= 0x2E80 || (cp >= 0x3000 && cp <= 0x303F) ||
         (cp >= 0xFF00 && cp <= 0xFFEF);
}

function songGlyph(ch, size) {
  if (!songReady || !songMeta) return null;
  const idx = songMeta.map[String(ch.codePointAt(0))];
  if (idx === undefined) return null;
  const key = 'song:' + size + ':' + ch;
  let g = glyphs.get(key);
  if (g) return g;
  const cell = songMeta.cell;
  const out = document.createElement('canvas');
  out.width = size; out.height = size;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  const sx = (idx % songMeta.cols) * cell;
  const sy = Math.floor(idx / songMeta.cols) * cell;
  o.drawImage(songImg, sx, sy, cell, cell, 0, 0, size, size);
  g = { canvas: out, w: size, size, baseline: Math.round(songMeta.ascent * size / 24), song: true };
  glyphs.set(key, g);
  return g;
}

function wqyGlyph(ch, size) {
  const f = wqyFonts[size];
  if (!f) return null;
  const idx = f.meta.map[String(ch.codePointAt(0))];
  if (idx === undefined) return null;
  const key = 'wqy:' + size + ':' + ch;
  let g = glyphs.get(key);
  if (g) return g;
  const cellW = f.meta.cellW || f.meta.cell;
  const cellH = f.meta.cellH || f.meta.cell;
  const out = document.createElement('canvas');
  out.width = cellW; out.height = cellH;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  const sx = (idx % f.meta.cols) * cellW;
  const sy = Math.floor(idx / f.meta.cols) * cellH;
  o.drawImage(f.img, sx, sy, cellW, cellH, 0, 0, cellW, cellH);
  g = { canvas: out, w: cellW, size: cellH, baseline: f.meta.ascent, wqy: true };
  glyphs.set(key, g);
  return g;
}

function serifGlyph(ch, size, family = 'T5Serif') {
  const ready = family === 'T5Sans' ? sansReady : serifReady;
  if (!ready || !NOTO_CHARS.has(ch)) return null;
  const key = 'outline:' + family + ':' + size + ':' + ch;
  let g = glyphs.get(key);
  if (g) return g;

  const asc = Math.round(size * 1.17);
  const cellH = Math.round(size * 1.50);
  measureCtx.font = size + 'px ' + family;
  const m = measureCtx.measureText(ch);
  const w = Math.max(1, Math.ceil(m.width));
  const c = document.createElement('canvas');
  c.width = w; c.height = cellH;
  const g2 = c.getContext('2d', { willReadFrequently: true });
  g2.clearRect(0, 0, w, cellH);
  g2.font = size + 'px ' + family;
  g2.textBaseline = 'alphabetic';
  g2.fillStyle = '#000';
  g2.fillText(ch, 0, asc);

  const src = g2.getImageData(0, 0, w, cellH);
  const out = document.createElement('canvas');
  out.width = w; out.height = cellH;
  const o = out.getContext('2d');
  const id = o.createImageData(w, cellH);
  for (let i = 0; i < w * cellH; i++) {
    if (src.data[i * 4 + 3] > 96) id.data[i * 4 + 3] = 255;
  }
  o.putImageData(id, 0, 0);
  g = { canvas: out, w, size: cellH, baseline: asc, serif: family === 'T5Serif', sans: family === 'T5Sans' };
  glyphs.set(key, g);
  return g;
}

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];

function ascentFor(size) {
  if (size === 8) return 7;
  if (size === 10) return 8;
  if (size === 12) return 10;
  if (size >= 24 && activeFont === 'pixel') return Math.round(size * 22 / 24);
  if (wqyFonts[size]) return wqyFonts[size].meta.ascent;
  if (DETAIL_SIZES.includes(size) && (serifReady || sansReady)) return Math.round(size * 1.17);
  if (size === 14) return 12;
  if (size === 16) return 14;
  return Math.round(size * 22 / 24); // 24 px Song ascent
}

function basePixelGlyph(ch, size) {
  const spec = PIXEL_FACES[size];
  if (!spec) return null;
  const key = size + ':' + ch;
  let g = glyphs.get(key);
  if (g) return g;

  measureCtx.font = size + 'px ' + spec.family;
  const m = measureCtx.measureText(ch);
  const w = Math.max(1, Math.ceil(m.width));
  const baseline = Math.round(size * 10 / 12);
  const c = document.createElement('canvas');
  c.width = w; c.height = size;
  const g2 = c.getContext('2d', { willReadFrequently: true });
  g2.clearRect(0, 0, w, size);
  g2.font = size + 'px ' + spec.family;
  g2.textBaseline = 'alphabetic';
  g2.fillStyle = '#000';
  g2.fillText(ch, 0, baseline);

  const src = g2.getImageData(0, 0, w, size);
  const out = document.createElement('canvas');
  out.width = w; out.height = size;
  const o = out.getContext('2d');
  const id = o.createImageData(w, size);
  for (let i = 0; i < w * size; i++) {
    if (src.data[i * 4 + 3] > 96) {
      id.data[i * 4 + 3] = 255;      // black, fully opaque
    }
  }
  o.putImageData(id, 0, 0);
  g = { canvas: out, w, size, baseline };
  glyphs.set(key, g);
  return g;
}

function glyph(ch, size = 12) {
  if ((size === 14 || size === 16) && isSongChar(ch)) {
    const wg = wqyGlyph(ch, size);
    if (wg) return wg;
  }
  const pixelMode = size >= 24 && activeFont === 'pixel';
  if (pixelMode && isSongChar(ch)) {
    const sg = songGlyph(ch, size);
    if (sg) return sg;
  }
  if (!pixelMode && DETAIL_SIZES.includes(size)) {
    const family = activeFont === 'sans' ? 'T5Sans' : 'T5Serif';
    const sg = serifGlyph(ch, size, family);
    if (sg) return sg;
  }
  if (!pixelMode && size >= 14 && isSongChar(ch)) {
    const sg = songGlyph(ch, size);
    if (sg) return sg;
  }
  if (PIXEL_FACES[size]) return basePixelGlyph(ch, size);

  const key = size + ':' + ch;
  let g = glyphs.get(key);
  if (g) return g;
  const b = basePixelGlyph(ch, 12);
  const s = size / 12;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(b.w * s)); out.height = size;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.drawImage(b.canvas, 0, 0, out.width, out.height);
  g = { canvas: out, w: out.width, size, baseline: Math.round(10 * s) };
  glyphs.set(key, g);
  return g;
}

function textWidth(str, size = 12) {
  let w = 0;
  for (const ch of Array.from(String(str))) w += glyph(ch, size).w;
  return w;
}

/* x is the anchor; y is the alphabetic baseline, like ctx.fillText(). */
function text(ctx, str, x, y, size = 12, align = 'left') {
  const total = textWidth(str, size);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const ascent = ascentFor(size);
  ctx.imageSmoothingEnabled = false;
  for (const ch of Array.from(String(str))) {
    const g = glyph(ch, size);
    if (g.w > 0) {
      ctx.drawImage(g.canvas, Math.round(cx), Math.round(y - ascent));
    }
    cx += g.w;
  }
}

function fitText(str, maxWidth, size = 12) {
  let out = '';
  for (const ch of Array.from(String(str))) {
    if (textWidth(out + ch, size) > maxWidth) break;
    out += ch;
  }
  return out;
}

function wrapText(str, maxWidth, size = 12) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      const test = line + ch;
      if (line && textWidth(test, size) > maxWidth) { out.push(line); line = ch; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

/* ---------- drawing helpers ---------- */
function fillWhite(ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
function hline(ctx, x1, x2, y) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y + .5); ctx.lineTo(x2, y + .5); ctx.stroke(); }

/* ---------- JS Lab ---------- */
let jsCache = { code: null, bits: null, packed: null, hash: 0, error: null };

function saveJSCode() {
  try { localStorage.setItem('t5.device.js', state.jsCode); } catch (e) {}
}

function errorFrame(msg) {
  const paper = T5Paper.create();
  paper.clear(0);
  paper.text(4, 4, "ERROR", 1, 1);
  let y = 20;
  const text = String(msg || "unknown").replace(/\s+/g, " ");
  let line = "";
  let count = 0;
  for (const ch of text) {
    const test = line + ch;
    if (line && paper.textWidth(test, 1) > 112) {
      paper.text(4, y, line, 1, 1);
      y += paper.lineHeight(1);
      line = ch;
      if (++count >= 6) break;
    } else {
      line = test;
    }
  }
  if (line && y < 236) paper.text(4, y, line, 1, 1);
  paper.commit();
  return paper;
}

function executeJS() {
  if (!window.T5Paper || !T5Paper.ready()) {
    jsCache = { code: state.jsCode, bits: new Uint8Array(W * H), packed: null, hash: 0,
      error: new Error("设备字库/模拟器未加载") };
    return jsCache;
  }
  const issue = T5Paper.sourceIssue(state.jsCode);
  let paper = null;
  let error = null;
  if (issue) {
    error = new Error(issue);
  } else {
    paper = T5Paper.create();
    try {
      const print = function () {
        const s = Array.prototype.map.call(arguments, String).join(" ");
        console.log(s);
      };
      const noop = function () {};
      const fn = new Function("paper", "print", "gc", "load", "setTimeout", "clearTimeout",
        state.jsCode + "\n//# sourceURL=t5-device-script.js");
      fn(paper, print, noop, noop, noop, noop);
      paper.commit();
    } catch (e) {
      error = e;
    }
  }
  if (error) {
    try { paper = errorFrame(error.message || error); } catch (e2) {}
  }
  if (!paper) paper = T5Paper.create();
  jsCache = {
    code: state.jsCode,
    bits: paper.getBits(),
    packed: paper.getPacked(),
    hash: paper.hash || 0,
    error
  };
  return jsCache;
}

function drawJS(ctx) {
  fillWhite(ctx);
  if (!jsCache.bits || jsCache.code !== state.jsCode || jsCache.bits.length !== W * H) executeJS();
  const b = jsCache.bits || new Uint8Array(W * H);
  const id = ctx.createImageData(W, H);
  for (let i = 0; i < b.length; i++) {
    const v = b[i] ? 0 : 255;
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

function runJS() {
  executeJS();
  render();
  if (jsCache.error) {
    setStatus("JS 错误：" + String(jsCache.error.message || jsCache.error), "bad");
  } else {
    const h = jsCache.hash ? " · #" + (jsCache.hash >>> 0).toString(16) : "";
    const over = deviceByteLength() > SCRIPT_MAX;
    setStatus("模拟运行完成 · 122×250 · 与设备同一 API/字库" + h +
      (over ? " · 超过 4096 B，只能发位图" : ""), over ? "bad" : "ok");
  }
}

/* ---------- device ES5 source ---------- */
function deviceByteLength() {
  return new TextEncoder().encode(state.jsCode).length;
}
function updateDeviceMeta() {
  const el = $('#jsBytes');
  if (!el) return;
  const n = deviceByteLength();
  el.textContent = n + ' / ' + SCRIPT_MAX + ' B';
  el.classList.toggle('bad', n === 0 || n > SCRIPT_MAX);
}
function deviceSourceIssue() {
  if (window.T5Paper && T5Paper.sourceIssue) return T5Paper.sourceIssue(state.jsCode);
  return '模拟器未加载';
}


/* ---------- 每日一句 ---------- */
const DAILY_QUOTES = (window.T5_QUOTES && window.T5_QUOTES.length)
  ? window.T5_QUOTES
  : [{ text: '慢一点，也是一种前进。', author: 'AirPage', source: '' }];

function localDateKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function dailyHash(str) {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dailyPick() {
  const n = DAILY_QUOTES.length;
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(state.dailyDate)) ? state.dailyDate : localDateKey();
  const base = dailyHash(dateKey) % n;
  const offset = Math.trunc(Number(state.dailyOffset) || 0);
  const index = ((base + offset) % n + n) % n;
  return { quote: DAILY_QUOTES[index], index, base, dateKey, offset };
}

function dailyDateLabel(key) {
  return String(key).slice(5).replace('-', '.');
}

function dailyByline(q) {
  return '—— ' + [q.author, q.source].filter(Boolean).join(' ');
}

function fitDaily(text, maxW, maxH) {
  const sizes = [24, 22, 20, 18, 16, 14, 12, 10];
  for (const size of sizes) {
    const lines = wrapText(text, maxW, size);
    const lineHeight = Math.max(size + 5, Math.round(size * 1.4));
    if (lines.length * lineHeight <= maxH) {
      return { size, lines, lineHeight, ascent: ascentFor(size) };
    }
  }
  const size = 10;
  const lines = wrapText(text, maxW, size);
  return { size, lines, lineHeight: 15, ascent: ascentFor(size) };
}

function drawDaily(ctx) {
  fillWhite(ctx);
  const info = dailyPick();
  const landscape = state.orientation === 'landscape';
  const previousFont = activeFont;
  activeFont = 'serif';

  const margin = landscape ? 10 : 9;
  const left = landscape ? 14 : 13;
  const right = landscape ? W - 10 : W - margin;
  const maxW = right - left;
  const bodyTop = landscape ? 36 : 38;
  const bodyBottom = landscape ? H - 30 : H - 40;

  text(ctx, '每日一句', margin, 15, 10);
  text(ctx, dailyDateLabel(info.dateKey), W - margin, 15, 10, 'right');
  hline(ctx, margin, W - margin, 24);

  ctx.fillStyle = '#000';
  ctx.fillRect(4, bodyTop, 2, Math.max(1, bodyBottom - bodyTop));

  const fit = fitDaily(info.quote.text, maxW, bodyBottom - bodyTop);
  const blockH = fit.lines.length * fit.lineHeight;
  const start = bodyTop + Math.max(0, (bodyBottom - bodyTop - blockH) / 2);
  fit.lines.forEach((line, i) => {
    text(ctx, line, left, start + fit.ascent + i * fit.lineHeight, fit.size);
  });

  let by = dailyByline(info.quote);
  let bySize = 10;
  if (textWidth(by, bySize) > maxW) bySize = 8;
  by = fitText(by, maxW, bySize);
  text(ctx, by, left, H - (landscape ? 12 : 17), bySize);
  hline(ctx, left, right, H - (landscape ? 24 : 29));

  activeFont = previousFont;
}

function refreshDailyMeta() {
  const el = $('#dailyMeta');
  if (!el) return;
  const info = dailyPick();
  el.textContent = '当前：第 ' + (info.index + 1) + ' / ' + DAILY_QUOTES.length +
    ' 句 · ' + info.quote.author + ' · ' + info.dateKey;
}

/* ---------- templates ---------- */
const templates = {
  photo: { name: '照片', sub: 'Photo', icon: '▧', draw: drawPhoto },
  daily: { name: '每日一句', sub: 'Daily', icon: '❞', draw: drawDaily },
  js:    { name: 'JS 画布', sub: 'Device / Simulator', icon: '⌨', draw: drawJS }
};

function drawPhoto(ctx) {
  fillWhite(ctx);
  if (!state.photo) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.strokeRect(8, 8, W - 16, H - 16); ctx.setLineDash([]);
    text(ctx, '上传一张照片', W / 2, H / 2 - 4, 12, 'center');
    text(ctx, '自动裁切为 ' + W + '×' + H, W / 2, H / 2 + 18, 12, 'center');
    return;
  }
  const img = state.photo;
  const s = Math.max(W / img.width, H / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.imageSmoothingEnabled = false;

  const cap = state.caption.trim();
  if (cap) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, H - 20, W, 20);
    text(ctx, fitText(cap, W - 12, 12), W / 2, H - 5, 12, 'center');
  }
}

/* ---------- rendering ---------- */
let packed = new Uint8Array(IMAGE_BYTES);
let bits = new Uint8Array(W * H);

function render() {
  if (!fontReady) return;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.imageSmoothingEnabled = false;
  bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, W, H);
  (templates[state.template] || templates.photo).draw(bctx);
  const img = bctx.getImageData(0, 0, W, H);
  const dither = state.template === 'photo' ? state.dither : 'threshold';
  bits = quantize(img, dither);
  packed = pack(bits);
  drawPreview();
}

function quantize(img, mode) {
  const d = img.data;
  const n = W * H;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gray[i] = Math.round(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]);
  }
  const out = new Uint8Array(n);
  if (mode === 'threshold' || mode === 'none') {
    for (let i = 0; i < n; i++) out[i] = gray[i] < 145 ? 1 : 0;
    return out;
  }
  if (mode === 'bayer') {
    const B = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = (B[(y & 3) * 4 + (x & 3)] + 0.5) / 16 * 255;
      out[i] = gray[i] < t ? 1 : 0;
    }
    return out;
  }
  const g = new Float32Array(gray);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const old = g[i];
      const nv = old < 128 ? 0 : 255;
      out[i] = nv === 0 ? 1 : 0;
      const err = old - nv;
      if (x + 1 < W) g[i + 1] += err * 7 / 16;
      if (y + 1 < H) {
        if (x > 0) g[i + W - 1] += err * 3 / 16;
        g[i + W] += err * 5 / 16;
        if (x + 1 < W) g[i + W + 1] += err * 1 / 16;
      }
    }
  }
  return out;
}

function pack(viewBits) {
  const out = new Uint8Array(IMAGE_BYTES);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!viewBits[y * W + x]) continue;
      let px, py;
      if (state.orientation === 'portrait') {
        px = x; py = y;
      } else {
        /* 250x122 landscape -> 122x250 portrait, rotate 90° CW */
        px = y; py = PANEL_H - 1 - x;
      }
      out[py * STRIDE + (px >> 3)] |= 1 << (7 - (px & 7));
    }
  }
  return out;
}

function drawPreview() {
  const id = pctx.createImageData(W, H);
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i] ? 0 : 255;
    const p = i * 4;
    id.data[p] = id.data[p + 1] = id.data[p + 2] = v;
    id.data[p + 3] = 255;
  }
  pctx.putImageData(id, 0, 0);
}

/* ---------- orientation ---------- */
function setOrientation(o) {
  if (state.template === 'js') {
    if (o === 'landscape') setStatus('设备脚本固定 122×250 竖屏，与设备 API 一致', 'bad');
    o = 'portrait';
  }
  state.orientation = o === 'landscape' ? 'landscape' : 'portrait';
  W = state.orientation === 'landscape' ? PANEL_H : PANEL_W;
  H = state.orientation === 'landscape' ? PANEL_W : PANEL_H;
  base.width = W; base.height = H;
  bctx = base.getContext('2d', { willReadFrequently: true });
  preview.width = W; preview.height = H;
  preview.style.width = (W * 2) + 'px';
  preview.style.aspectRatio = W + ' / ' + H;
  document.querySelector('.paperwrap').classList.toggle('landscape', state.orientation === 'landscape');
  $$('#orient button').forEach(b => {
    b.classList.toggle('active', b.dataset.orient === state.orientation);
    b.disabled = state.template === 'js' && b.dataset.orient === 'landscape';
    b.title = state.template === 'js' && b.dataset.orient === 'landscape' ? '设备脚本固定竖屏' : '';
  });
  render();
}

/* ---------- controls ---------- */
function tplList() {
  $('#tplList').innerHTML = Object.entries(templates).map(([k, t]) =>
    '<button class="tpl" data-tpl="' + k + '"><span class="ico">' + t.icon + '</span>' +
    '<span><span>' + esc(t.name) + '</span><span class="sub">' + esc(t.sub) + '</span></span></button>'
  ).join('');
  $$('#tplList .tpl').forEach(b => b.onclick = () => {
    state.template = b.dataset.tpl;
    setOrientation(state.orientation);
    renderControls();
    syncTplButtons();
    if (state.template === 'js') {
      runJS();
    } else {
      render();
      setStatus(state.template === 'photo' ? '照片：选择图片后发送' : '每日一句：点“换一句”切换');
    }
  });
}
function syncTplButtons() {
  $$('#tplList .tpl').forEach(b => b.classList.toggle('active', b.dataset.tpl === state.template));
}

function renderControls() {
  const c = $('#controls');
  let h = '';
  if (state.template === 'photo') {
    h += '<div class="row"><label>照片</label><input id="photoFile" type="file" accept="image/*"></div>';
    h += '<div class="row"><label>图注（可选）</label><input id="caption" type="text" maxlength="18" value="' + esc(state.caption) + '"></div>';
    h += '<div class="row"><label>抖动</label><select id="dither"><option value="fs">Floyd–Steinberg（照片）</option><option value="bayer">Bayer（纹理）</option><option value="none">无（高对比）</option></select></div>';
    h += '<p class="tiny">原图只在本机 Canvas 里处理，不上传服务器。</p>';
  } else if (state.template === 'daily') {
    const info = dailyPick();
    h += '<div class="row"><label>日期</label><input id="dailyDate" type="date" value="' + esc(info.dateKey) + '"></div>';
    h += '<div class="row daily-actions">' +
      '<button class="btn" id="dailyPrev">‹ 上一句</button>' +
      '<button class="btn primary" id="dailyNext">换一句 ›</button>' +
      '<button class="btn" id="dailyToday">今天</button>' +
      '</div>';
    h += '<p class="tiny" id="dailyMeta">当前：第 ' + (info.index + 1) + ' / ' + DAILY_QUOTES.length +
      ' 句 · ' + esc(info.quote.author) + ' · ' + esc(info.dateKey) + '</p>';
    h += '<p class="tiny">本地语料，共 ' + DAILY_QUOTES.length + ' 句；按日期确定性选择，点按钮切换。不会联网，也不会上传文字。</p>';
  } else if (state.template === 'js') {
    const samples = (window.T5Paper && T5Paper.samples) || {};
    h += '<p class="tiny">这里就是 T5 的设备 JS 模拟器：浏览器按设备同一套 API、同一份 12px 大字库（31K）、同一个 122×250 1-bit 帧缓冲运行。Run 预览，发送位图，或把同一份源码推送到设备执行。</p>';
    h += '<div class="row"><label>用例</label><select id="jsExample">' +
      Object.entries(samples).map(([k, s]) => '<option value="' + k + '">' + esc(s.name) + '</option>').join('') +
      '<option value="custom">自定义</option>' +
      '</select></div>';
    h += '<div class="row"><label>设备脚本（ES5，≤' + SCRIPT_MAX + ' B）</label><textarea id="jsCode" class="code" rows="17" spellcheck="false" autocapitalize="off" autocorrect="off">' + esc(state.jsCode) + '</textarea></div>';
    h += '<div class="row js-run-row"><button class="btn primary" id="jsRun">▶ Run</button><span id="jsBytes" class="bytecount">' + deviceByteLength() + ' / ' + SCRIPT_MAX + ' B</span></div>';
    h += '<div class="row device-file"><input id="scriptFile" type="file" accept=".js,.txt,text/javascript,application/javascript"><span class="tiny">载入 .js 覆盖当前脚本</span></div>';
    h += '<div class="row device-actions"><button class="btn primary" id="scriptPush">⇪ 推送脚本</button><button class="btn" id="scriptRun">▶ 运行已存</button></div>';
    h += '<p class="tiny">API：paper.clear / setPixel / fillRect / text / textWidth / lineHeight / width / height / commit。只有一种 12px 大字库（31K 字形），lineHeight 返回 13；scale 参数保留但被忽略。脚本固定竖屏 122×250。连接 T5 后可推送，成功后执行、刷新并保存到 NVS；失败保留上一版。脚本在主线程执行，死循环会卡住页面。</p>';
  }
  c.innerHTML = h;

  const bind = (id, key, fn) => {
    const el = $('#' + id); if (!el) return;
    el.addEventListener('input', () => { state[key] = fn ? fn(el.value) : el.value; render(); });
  };
  bind('caption', 'caption');
  const dd = $('#dailyDate');
  if (dd) {
    dd.value = dailyPick().dateKey;
    dd.onchange = () => {
      state.dailyDate = /^\d{4}-\d{2}-\d{2}$/.test(dd.value) ? dd.value : localDateKey();
      state.dailyOffset = 0;
      render();
      refreshDailyMeta();
    };
  }
  const dailyMove = (delta) => {
    state.dailyOffset = Math.trunc(Number(state.dailyOffset) || 0) + delta;
    render();
    refreshDailyMeta();
    setStatus(delta > 0 ? '已换下一句；发送后屏幕更新' : '已换上一句；发送后屏幕更新');
  };
  const dp = $('#dailyPrev'); if (dp) dp.onclick = () => dailyMove(-1);
  const dn = $('#dailyNext'); if (dn) dn.onclick = () => dailyMove(1);
  const dt = $('#dailyToday');
  if (dt) dt.onclick = () => {
    state.dailyDate = localDateKey();
    state.dailyOffset = 0;
    if (dd) dd.value = state.dailyDate;
    render();
    refreshDailyMeta();
    setStatus('已回到今天');
  };
  const jc = $('#jsCode');
  if (jc) {
    jc.value = state.jsCode;
    jc.addEventListener('input', () => {
      state.jsCode = jc.value;
      state.jsExample = 'custom';
      const sel = $('#jsExample');
      if (sel) sel.value = 'custom';
      saveJSCode();
      updateDeviceMeta();
      syncBtButtons();
    });
  }
  const je = $('#jsExample');
  if (je) {
    je.value = state.jsExample || 'hello';
    je.onchange = () => {
      if (je.value === 'custom') return;
      const s = window.T5Paper && T5Paper.samples[je.value];
      if (!s) return;
      state.jsExample = je.value;
      state.jsCode = s.code;
      saveJSCode();
      renderControls();
      runJS();
    };
  }
  const jr = $('#jsRun');
  if (jr) jr.onclick = runJS;

  const sf = $('#scriptFile');
  if (sf) {
    sf.onchange = async () => {
      const file = sf.files && sf.files[0];
      if (!file) return;
      if (file.size > 65536) { setStatus('脚本文件过大（>64 KB）', 'bad'); sf.value = ''; return; }
      try {
        let text = await file.text();
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        state.jsCode = text;
        state.jsExample = 'custom';
        if (jc) jc.value = text;
        saveJSCode();
        updateDeviceMeta();
        syncBtButtons();
        runJS();
        setStatus('已载入 ' + file.name + '，已用模拟器运行', 'ok');
      } catch (e) {
        setStatus('读取脚本失败：' + (e.message || e), 'bad');
      }
      sf.value = '';
    };
  }
  const sp = $('#scriptPush');
  if (sp) sp.onclick = pushScript;
  const sr = $('#scriptRun');
  if (sr) sr.onclick = runStoredScript;
  updateDeviceMeta();
  syncBtButtons();
  const d = $('#dither'); if (d) { d.value = state.dither; d.onchange = () => { state.dither = d.value; render(); }; }
  const f = $('#photoFile'); if (f) f.onchange = () => {
    const file = f.files && f.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => { state.photo = img; render(); setStatus('照片已载入，可以发送'); };
    img.onerror = () => setStatus('图片读取失败', 'bad');
    img.src = URL.createObjectURL(file);
  };
}

/* ---------- bluetooth ---------- */
let btDevice = null, btServer = null, btService = null;
let ctrlChar = null, dataChar = null, infoChar = null;
let doneWaiter = null;
let btBusy = false, transferKind = '', deviceSupportsScript = false;

function syncBtButtons() {
  const connected = !!ctrlChar;
  const n = deviceByteLength();
  const send = $('#send');
  if (send) send.disabled = !connected || btBusy;
  const push = $('#scriptPush');
  if (push) push.disabled = !connected || !deviceSupportsScript || btBusy || n === 0 || n > SCRIPT_MAX;
  const run = $('#scriptRun');
  if (run) run.disabled = !connected || !deviceSupportsScript || btBusy;
  const file = $('#scriptFile');
  if (file) file.disabled = btBusy;
}
function setBtBusy(v) {
  btBusy = !!v;
  syncBtButtons();
}

async function connect() {
  if (!navigator.bluetooth) {
    setStatus('当前浏览器不支持 Web Bluetooth；Android Chrome / 桌面 Chrome 可用，iPhone Safari 不支持。', 'bad');
    return;
  }
  if (!window.isSecureContext) {
    setStatus('Web Bluetooth 需要 HTTPS（或 localhost）。请用 HTTPS 打开此页面。', 'bad');
    return;
  }
  const btn = $('#connect');
  btn.disabled = true; deviceSupportsScript = false; setStatus('正在搜索 T5…');
  try {
    btDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }],
      optionalServices: [SERVICE]
    });
    btDevice.addEventListener('gattserverdisconnected', onDisconnected);
    btServer = await btDevice.gatt.connect();
    btService = await btServer.getPrimaryService(SERVICE);
    ctrlChar = await btService.getCharacteristic(CTRL);
    dataChar = await btService.getCharacteristic(DATA);
    infoChar = await btService.getCharacteristic(INFO);
    const rawInfo = await infoChar.readValue();
    const info = new Uint8Array(rawInfo.buffer, rawInfo.byteOffset, rawInfo.byteLength);
    if (String.fromCharCode(...info.slice(0, 4)) !== 'T5AP') throw new Error('not a T5 AirPage device ' + [...info].map(b => b.toString(16).padStart(2, '0')).join(''));
    const w = info[6] | info[7] << 8, h = info[8] | info[9] << 8, stride = info[10] | info[11] << 8;
    if (w !== PANEL_W || h !== PANEL_H || stride !== STRIDE) throw new Error('panel mismatch ' + w + 'x' + h);
    deviceSupportsScript = !!(info[5] & 2);
    await ctrlChar.startNotifications();
    ctrlChar.addEventListener('characteristicvaluechanged', onNotify);
    $('#devname').textContent = btDevice.name || 'T5';
    $('#exit').hidden = false;
    setDot('on');
    setStatus('已连接 ' + (btDevice.name || 'T5') + (deviceSupportsScript ? '，可发送图像/脚本' : '；此固件不支持脚本推送'));
    btn.textContent = '已连接'; btn.disabled = true;
    syncBtButtons();
  } catch (e) {
    console.warn(e);
    try { if (btDevice && btDevice.gatt.connected) btDevice.gatt.disconnect(); } catch (_) {}
    ctrlChar = dataChar = infoChar = null;
    btService = null; btServer = null; deviceSupportsScript = false;
    setStatus('连接失败：' + (e.message || e), 'bad');
    setDot(''); btn.disabled = false; syncBtButtons();
  }
}

function onDisconnected() {
  ctrlChar = dataChar = infoChar = null; btService = null; btServer = null;
  deviceSupportsScript = false; btBusy = false; transferKind = '';
  if (doneWaiter) {
    const r = doneWaiter; doneWaiter = null;
    r.reject(new Error('设备已断开'));
  }
  $('#exit').hidden = true;
  $('#devname').textContent = '未连接'; $('#connect').disabled = false; $('#connect').textContent = '连接 T5';
  setDot(''); setStatus('设备已断开，仍在广播');
  syncBtButtons();
}

function onNotify(e) {
  const dv = e.target.value;
  if (dv.byteLength < 8 || dv.getUint8(0) !== 0x80) return;
  const code = dv.getUint8(1);
  const val = dv.getUint32(4, true);
  if (code === 0) {
    setStatus(transferKind === 'script' ? '设备已准备好，接收脚本…' :
      transferKind === 'run' ? '正在运行已存脚本…' : '设备已准备好，接收中…');
    setDot('busy');
  } else if (code === 1) {
    setStatus(transferKind === 'script'
      ? '脚本已接收 ' + val + ' 字节，执行并刷新屏幕…'
      : '已接收 ' + val + ' 字节，正在刷新屏幕…');
    setDot('busy');
  } else if (code === 2) {
    setStatus(transferKind === 'script' ? '✓ 脚本已推送并显示在 T5 上' :
      transferKind === 'run' ? '✓ 已运行设备中保存的脚本' : '✓ 已显示在 T5 上', 'ok');
    setDot('on'); setProgress(100);
    if (doneWaiter) { const r = doneWaiter; doneWaiter = null; r.resolve(val); }
  } else {
    const names = {
      3:'尺寸/格式错误', 4:'CRC 校验失败', 5:'数据偏移错误', 6:'已取消',
      7:'状态错误', 8:'渲染失败', 9:'传输超时', 10:'内存不足',
      11:'脚本执行失败（ES5 语法/API/字库）', 12:'NVS 保存失败（脚本过大）'
    };
    const msg = names[code] || ('错误 ' + code);
    setStatus((transferKind === 'script' ? '脚本推送失败：' : '发送失败：') + msg, 'bad');
    setDot('on');
    if (doneWaiter) { const r = doneWaiter; doneWaiter = null; r.reject(new Error(msg)); }
  }
}

function setProgress(p) { $('#bar').style.width = Math.max(0, Math.min(100, p)) + '%'; }

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function waitDone(ms = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { doneWaiter = null; reject(new Error('等待设备超时')); }, ms);
    doneWaiter = {
      resolve: (value) => { clearTimeout(t); resolve(value); },
      reject: (e) => { clearTimeout(t); reject(e); }
    };
  });
}

async function writeCtrl(bytes) { await ctrlChar.writeValueWithResponse(bytes); }
async function writeData(bytes, withResponse) {
  if (withResponse || !dataChar.writeValueWithoutResponse) await dataChar.writeValueWithResponse(bytes);
  else await dataChar.writeValueWithoutResponse(bytes);
}

async function sendImage() {
  if (!ctrlChar || !dataChar) { setStatus('请先连接 T5', 'bad'); return; }
  if (state.template === 'js') {
    if (state.orientation !== 'portrait') setOrientation('portrait');
    executeJS();
    render();
    if (jsCache.error) {
      setStatus('JS 有错误，先修好再发送：' + String(jsCache.error.message || jsCache.error), 'bad');
      return;
    }
  }
  if (btBusy) return;
  transferKind = 'image';
  setBtBusy(true); setDot('busy'); setProgress(0);
  try {
    const crc = crc32(packed);
    async function beginTransfer() {
      const begin = new Uint8Array(14);
      const bv = new DataView(begin.buffer);
      bv.setUint8(0, 0x01); bv.setUint32(1, IMAGE_BYTES, true);
      bv.setUint16(5, PANEL_W, true); bv.setUint16(7, PANEL_H, true);
      bv.setUint32(9, crc, true); bv.setUint8(13, 0x01);
      await writeCtrl(begin);
    }

    let chunk = 100;
    let withResponse = false;
    let attempt = 0;
    for (;;) {
      try {
        await beginTransfer();
        let off = 0;
        setProgress(0);
        while (off < IMAGE_BYTES) {
          const n = Math.min(chunk, IMAGE_BYTES - off);
          const buf = new Uint8Array(2 + n);
          new DataView(buf.buffer).setUint16(0, off, true);
          buf.set(packed.subarray(off, off + n), 2);
          await writeData(buf, withResponse);
          off += n;
          setProgress(off / IMAGE_BYTES * 90);
        }
        break;
      } catch (e) {
        if (attempt++ === 0) {
          chunk = 20; withResponse = true;
          setStatus('MTU 较小，改用 20 字节分片…');
          try { await writeCtrl(new Uint8Array([0x04])); } catch (_) {}
          continue;
        }
        throw e;
      }
    }

    setProgress(95);
    const done = waitDone(30000);
    await writeCtrl(new Uint8Array([0x03]));
    setStatus('已发送，等待设备刷新…');
    await done;
  } catch (e) {
    console.warn(e);
    setStatus('发送失败：' + (e.message || e), 'bad');
  } finally {
    transferKind = '';
    setBtBusy(false);
    setDot(btDevice && btDevice.gatt.connected ? 'on' : '');
  }
}

async function pushScript() {
  if (!ctrlChar || !dataChar) { setStatus('请先连接 T5', 'bad'); return; }
  if (!deviceSupportsScript) { setStatus('当前固件不支持脚本推送（info flags 无脚本位）', 'bad'); return; }
  if (btBusy) return;
  const issue = deviceSourceIssue();
  if (issue) { setStatus('设备脚本检查：' + issue, 'bad'); return; }
  const source = new TextEncoder().encode(state.jsCode);
  if (source.length === 0) { setStatus('设备脚本为空', 'bad'); return; }
  if (source.length > SCRIPT_MAX) {
    setStatus('设备脚本 ' + source.length + ' B，超过 ' + SCRIPT_MAX + ' B 上限', 'bad');
    return;
  }
  executeJS();
  render();
  if (jsCache.error) {
    setStatus('脚本在模拟器中失败，未推送：' + String(jsCache.error.message || jsCache.error), 'bad');
    return;
  }

  transferKind = 'script';
  setBtBusy(true); setDot('busy'); setProgress(0);
  const crc = crc32(source);
  const begin = new Uint8Array(9);
  const bv = new DataView(begin.buffer);
  bv.setUint8(0, CMD_BEGIN_SCRIPT);
  bv.setUint32(1, source.length, true);
  bv.setUint32(5, crc, true);

  try {
    let chunk = 100;
    let withResponse = false;
    let attempt = 0;
    for (;;) {
      try {
        await writeCtrl(begin);
        let off = 0;
        setProgress(0);
        while (off < source.length) {
          const n = Math.min(chunk, source.length - off);
          const buf = new Uint8Array(2 + n);
          new DataView(buf.buffer).setUint16(0, off, true);
          buf.set(source.subarray(off, off + n), 2);
          await writeData(buf, withResponse);
          off += n;
          setProgress(off / source.length * 90);
        }
        break;
      } catch (e) {
        if (attempt++ === 0) {
          chunk = 20; withResponse = true;
          setStatus('MTU 较小，改用 20 字节分片…');
          try { await writeCtrl(new Uint8Array([CMD_ABORT_SCRIPT])); } catch (_) {}
          continue;
        }
        throw e;
      }
    }

    setProgress(95);
    const done = waitDone(30000);
    await writeCtrl(new Uint8Array([CMD_COMMIT_SCRIPT]));
    setStatus('脚本已提交，设备执行并刷新屏幕…');
    const deviceHash = await done;
    const expected = jsCache.hash >>> 0;
    if (deviceHash && expected && deviceHash !== expected) {
      setStatus('设备已执行，但位图哈希不一致：设备 #' + (deviceHash >>> 0).toString(16) +
        ' / 浏览器 #' + expected.toString(16), 'bad');
    } else {
      setStatus('脚本已运行并保存；预览与设备同源' + (expected ? ' · #' + expected.toString(16) : ''), 'ok');
    }
  } catch (e) {
    console.warn(e);
    setStatus('脚本推送失败：' + (e.message || e), 'bad');
  } finally {
    transferKind = '';
    setBtBusy(false);
    setDot(btDevice && btDevice.gatt.connected ? 'on' : '');
  }
}

async function runStoredScript() {
  if (!ctrlChar || !dataChar) { setStatus('请先连接 T5', 'bad'); return; }
  if (!deviceSupportsScript) { setStatus('当前固件不支持脚本', 'bad'); return; }
  if (btBusy) return;
  transferKind = 'run';
  setBtBusy(true); setDot('busy'); setProgress(0);
  try {
    const done = waitDone(30000);
    await writeCtrl(new Uint8Array([CMD_RUN_SCRIPT]));
    setStatus('已请求运行设备中保存的脚本…');
    await done;
    setStatus('设备已运行已存脚本；预览只在推送过同一份源码时一致', 'ok');
  } catch (e) {
    console.warn(e);
    setStatus('运行已存脚本失败：' + (e.message || e), 'bad');
  } finally {
    transferKind = '';
    setBtBusy(false);
    setDot(btDevice && btDevice.gatt.connected ? 'on' : '');
  }
}

async function disconnectDevice() {
  try { if (btDevice && btDevice.gatt.connected) btDevice.gatt.disconnect(); }
  catch (e) { setStatus('断开失败：' + e.message, 'bad'); }
}

function downloadPng() {
  const a = document.createElement('a');
  a.download = 't5-airpage-' + state.template + '-' + state.orientation + '.png';
  a.href = preview.toDataURL('image/png');
  a.click();
}

/* ---------- boot ---------- */
async function boot() {
  tplList();
  renderControls();
  syncTplButtons();

  $('#connect').onclick = connect;
  $('#send').onclick = sendImage;
  $('#exit').onclick = disconnectDevice;
  $('#download').onclick = downloadPng;
  $$('#orient button').forEach(b => b.onclick = () => setOrientation(b.dataset.orient));

  const compat = $('#compat');
  if (!navigator.bluetooth) {
    compat.classList.add('bad');
    compat.textContent = '此浏览器没有 Web Bluetooth。Android Chrome / 桌面 Chrome 可用；iPhone Safari 不支持，需要原生 App 或 Bluefy。';
  } else if (!window.isSecureContext) {
    compat.classList.add('bad');
    compat.textContent = '当前不是安全上下文。Web Bluetooth 需要 HTTPS 或 localhost。';
  } else {
    compat.textContent = 'Web Bluetooth 已就绪。设备开机即广播，点“连接 T5”。';
  }
  $('#secure').textContent = window.isSecureContext ? 'secure context' : 'insecure context';

  try {
    await loadPixelFont();
    try {
      await loadSongFont();
    } catch (e) {
      console.warn('24px Song atlas unavailable, Chinese will fall back to 12px cells', e);
      songReady = false;
    }
    await loadWqyFonts();
    try {
      await loadSerifFont();
    } catch (e) {
      console.warn('Noto Serif detail face unavailable; 18-32 will fall back to 24px Song', e);
      serifReady = false;
    }
    try {
      await T5Paper.load();
    } catch (e) {
      console.warn('Device font atlas unavailable', e);
      setStatus('设备字库加载失败，JS 模拟器不可用：' + (e.message || e), 'bad');
    }
    jsCache.code = null;
    setOrientation('portrait');
    renderControls();
  } catch (e) {
    console.error(e);
    setStatus('点阵字体加载失败：' + (e.message || e), 'bad');
  }

  window.__t5editor = {
    state, templates, render, crc32, W, H, PANEL_W, PANEL_H, STRIDE,
    fontSizes: FONT_SIZES, textWidth, glyph,
    songReady: () => songReady,
    getPacked: () => packed,
    getBits: () => bits,
    setOrientation,
    deviceByteLength, deviceSourceIssue, updateDeviceMeta,
    executeJS, jsCache: () => jsCache,
    pushScript, runStoredScript, syncBtButtons
  };
}
document.addEventListener('DOMContentLoaded', boot);
