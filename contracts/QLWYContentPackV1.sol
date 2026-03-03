// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title QLWYContentPackV1
/// @notice Provides textual and color assets for the renderer.
contract QLWYContentPackV1 {
    string[64] private _hexagramNames;
    string[64] private _hexagramJudgments;
    string[64] private _hexagramPinyins;
    string[64] private _hexagramShortNames;
    string[64] private _hexagramShortNamePinyins;


    string[5] private _rarityLabels;
    string[5] private _bgColors;
    string[5] private _strokeColors;

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    string public baseImageUri;
    string public font1Uri;
    string public font2Uri;

    constructor(string memory initialBaseImageUri, string memory initialFont1Uri, string memory initialFont2Uri) {
        _initNames();
        _initJudgments();
        _initPinyins();
        _initShortNames();
        _initShortNamePinyins();
        
        _rarityLabels = [unicode"普通", unicode"稀有", unicode"史诗", unicode"传奇", unicode"神话"];
        _bgColors = ["#EDEDEC", "#E7EAF6", "#F7EDEA", "#FFF6E2", "#F3E8FF"];
        _strokeColors = ["#2B2B2B", "#1D2C6A", "#7B2E1D", "#7A4E00", "#6B21A8"];

        owner = msg.sender;
        baseImageUri = initialBaseImageUri;

        font1Uri = initialFont1Uri;
        font2Uri = initialFont2Uri;
    }

    function setBaseImageUri(string calldata newUri) external onlyOwner {
        baseImageUri = newUri;
    }

    function setFont1Uri(string calldata newUri) external onlyOwner {
        font1Uri = newUri;
    }

    function setFont2Uri(string calldata newUri) external onlyOwner {
        font2Uri = newUri;
    }

    function _u(uint256 x) private pure returns (string memory) {
        if (x == 0) return "0";
        uint256 t = x; uint256 len;
        while (t != 0) { len++; t /= 10; }
        bytes memory b = new bytes(len);
        while (x != 0) { b[--len] = bytes1(uint8(48 + x % 10)); x /= 10; }
        return string(b);
    }

    function imageUri(uint16 id, uint8 rarity, uint8 luck) public view returns (string memory) {
        return string(abi.encodePacked(baseImageUri, "/", _u(id), "_", _u(rarity), "_", _u(luck), ".png"));
    }

    function fontStyle() public view returns (string memory) {
        return string(
            abi.encodePacked(
                "@font-face{font-family:'LDQ';",
                "src:url('", font1Uri, "') format('woff2');",
                "font-weight:normal;font-style:normal;}",
                "@font-face{font-family:'FZQKB';",
                "src:url('", font2Uri, "') format('woff2');",
                "font-weight:normal;font-style:normal;}"
            )
        );
    }

    function fontStyleTag() external view returns (string memory) {
        return string(
            abi.encodePacked("<style><![CDATA[", fontStyle(), "]]></style>")
        );
    }

    function _normalizeHexIndex(uint16 id) private pure returns (uint256) {
        if (id == 0) {
            return 0;
        }
        return (uint256(id) - 1) % 64;
    }


    function hexagramName(uint16 id) external view returns (string memory) {
        return _hexagramNames[_normalizeHexIndex(id)];
    }

    function hexagramJudgment(uint16 id) external view returns (string memory) {
        return _hexagramJudgments[_normalizeHexIndex(id)];
    }

    function hexagramPinyin(uint16 id) external view returns (string memory) {
        return _hexagramPinyins[_normalizeHexIndex(id)];
    }

    function hexagramShortName(uint16 id) external view returns (string memory) {
        return _hexagramShortNames[_normalizeHexIndex(id)];
    }

    function hexagramShortNamePinyin(uint16 id) external view returns (string memory) {
        return _hexagramShortNamePinyins[_normalizeHexIndex(id)];
    }

    function strokeColor(uint8 rarity) external view returns (string memory) {
        require(rarity < _strokeColors.length, "QLWY: rarity");
        return _strokeColors[rarity];
    }

    function bgColor(uint8 rarity) external view returns (string memory) {
        require(rarity < _bgColors.length, "QLWY: rarity");
        return _bgColors[rarity];
    }

    function rarityLabel(uint8 rarity) external view returns (string memory) {
        require(rarity < _rarityLabels.length, "QLWY: rarity");
        return _rarityLabels[rarity];
    }

    function _initNames() private {
        _hexagramNames = [
            unicode"乾为天",
            unicode"坤为地",
            unicode"水雷屯",
            unicode"山水蒙",
            unicode"水天需",
            unicode"天水讼",
            unicode"地水师",
            unicode"水地比",
            unicode"风天小畜",
            unicode"天泽履",
            unicode"地天泰",
            unicode"天地否",
            unicode"天火同人",
            unicode"火天大有",
            unicode"地山谦",
            unicode"雷地豫",
            unicode"泽雷随",
            unicode"山风蛊",
            unicode"泽地临",
            unicode"地风观",
            unicode"火雷噬嗑",
            unicode"山火贲",
            unicode"山地剥",
            unicode"地雷复",
            unicode"天雷无妄",
            unicode"山天大畜",
            unicode"山雷颐",
            unicode"泽风大过",
            unicode"坎为水",
            unicode"离为火",
            unicode"泽山咸",
            unicode"雷风恒",
            unicode"天山遯",
            unicode"雷天大壮",
            unicode"火地晋",
            unicode"地火明夷",
            unicode"风火家人",
            unicode"火泽睽",
            unicode"水山蹇",
            unicode"雷水解",
            unicode"山泽损",
            unicode"风雷益",
            unicode"泽天夬",
            unicode"天风姤",
            unicode"泽地萃",
            unicode"地风升",
            unicode"泽水困",
            unicode"水风井",
            unicode"泽火革",
            unicode"火风鼎",
            unicode"震为雷",
            unicode"艮为山",
            unicode"风山渐",
            unicode"雷泽归妹",
            unicode"雷火丰",
            unicode"火山旅",
            unicode"巽为风",
            unicode"兑为泽",
            unicode"风水涣",
            unicode"水泽节",
            unicode"风泽中孚",
            unicode"雷山小过",
            unicode"水火既济",
            unicode"火水未济"
        ];
    }

    function _initJudgments() private {
        _hexagramJudgments = [
            unicode"元，亨，利，贞。天行健，君子以自强不息。",
            unicode"元，亨，利，牝马之贞。君子有攸往，先迷后得，主利。西南得朋，东北丧朋。安贞吉。地势坤，君子以厚德载物。",
            unicode"元，亨，利贞。勿用有攸往，利建侯。云雷，屯。君子以经纶。",
            unicode"亨。匪我求童蒙，童蒙求我。初筮告，再三渎，渎则不告。利贞。山下出泉，蒙。君子以果行育德。",
            unicode"有孚，光亨，贞吉。利涉大川。云上于天，需。君子以饮食宴乐。",
            unicode"有孚，窒惕，中吉，终凶。利见大人，不利涉大川。天与水违行，讼。君子以作事谋始。",
            unicode"贞，丈人吉，无咎。地中有水，师。君子以容民畜众。",
            unicode"吉。原筮元永贞，无咎。不宁方来，后夫凶。地上有水，比。先王以建万国，亲诸侯。",
            unicode"亨。密云不雨，自我西郊。风行天上，小畜。君子以懿文德。",
            unicode"虎尾，不咥人，亨。上天下泽，履。君子以辨上下，定民志。",
            unicode"小往大来，吉亨。天地交，泰。后以财成天地之道，辅相天地之宜，以左右民。",
            unicode"否之匪人，不利君子贞，大往小来。天地不交，否。君子以俭德辟难，不可荣以禄。",
            unicode"同人于野，亨。利涉大川。利君子贞。天与火，同人。君子以类族辨物。",
            unicode"元亨。火在天上，大有。君子以遏恶扬善，顺天休命。",
            unicode"亨。君子有终。地中有山，谦。君子以裒多益寡，称物平施。",
            unicode"利建侯行师。雷出地奋，豫。先王以作乐崇德，殷荐之上帝，以配祖考。",
            unicode"元亨，利贞，无咎。泽中有雷，随。君子以向晦入宴息。",
            unicode"元亨，利涉大川。先甲三日，后甲三日。山下有风，蛊。君子以振民育德。",
            unicode"元亨利贞。至于八月有凶。泽上有地，临。君子以教思无穷，容保民无疆。",
            unicode"盥而不荐，有孚颙若。风行地上，观。先王以省方，观民设教。",
            unicode"亨。利用狱。雷电，噬嗑。先王以明罚敕法。",
            unicode"亨。小利有攸往。山下有火，贲。君子以明庶政，无敢折狱。",
            unicode"不利有攸往。山附于地，剥。上以厚下，安宅。",
            unicode"亨。出入无疾，朋来无咎。反复其道，七日来复，利有攸往。雷在地中，复。先王以至日闭关，商旅不行，后不省方。",
            unicode"元亨利贞。其匪正有眚，不利有攸往。天下雷行，物与无妄。先王以茂对时育万物。",
            unicode"利贞。不家食吉，利涉大川。天在山中，大畜。君子以多识前言往行，以畜其德。",
            unicode"贞吉。观颐，自求口实。山下有雷，颐。君子以慎言语，节饮食。",
            unicode"栋桡。利有攸往，亨。泽灭木，大过。君子以独立不惧，遁世无闷。",
            unicode"习坎。有孚，维心亨，行有尚。水洊至，习坎。君子以常德行，习教事。",
            unicode"利贞，亨。畜牝牛吉。明两作，离。大人以继明照于四方。",
            unicode"亨，利贞。取女吉。山上有泽，咸。君子以虚受人。",
            unicode"亨，无咎，利贞。利有攸往。雷风，恒。君子以立不易方。",
            unicode"亨。小利贞。天下有山，遯。君子以远小人，不恶而严。",
            unicode"利贞。雷在天上，大壮。君子以非礼勿履。",
            unicode"康侯用锡马蕃庶，昼日三接。明出地上，晋。君子以自昭明德。",
            unicode"利艰贞。明入地中，明夷。君子以莅众，用晦而明。",
            unicode"利女贞。风自火出，家人。君子以言有物，而行有恒。",
            unicode"小事吉。上火下泽，睽。君子以同而异。",
            unicode"利西南，不利东北。利见大人，贞吉。山上有水，蹇。君子以反身修德。",
            unicode"利西南。无所往，其来复吉。有攸往，夙吉。雷雨作，解。君子以赦过宥罪。",
            unicode"有孚，元吉，无咎。可贞。利有攸往。山下有泽，损。君子以惩忿窒欲。",
            unicode"利有攸往，利涉大川。风雷，益。君子以见善则迁，有过则改。",
            unicode"扬于王庭，孚号有厉。告自邑，不利即戎。利有攸往。泽上于天，夬。君子以施禄及下，居德则忌。",
            unicode"女壮，勿用取女。天下有风，姤。后以施命诰四方。",
            unicode"亨。王假有庙，利见大人，亨。利贞。用大牲吉，利有攸往。泽上于地，萃。君子以除戎器，戒不虞。",
            unicode"元亨。用见大人。勿恤。南征吉。地中生木，升。君子以顺德，积小以高大。",
            unicode"亨。贞。大人吉，无咎。有言不信。泽无水，困。君子以致命遂志。",
            unicode"改邑不改井，无丧无得，往来井井。汔至，亦未繘井，羸其瓶，凶。木上有水，井。君子以劳民劝相。",
            unicode"己日乃孚。元亨利贞。悔亡。泽中有火，革。君子以治历明时。",
            unicode"元吉，亨。木上有火，鼎。君子以正位凝命。",
            unicode"亨。震来虩虩，笑言哑哑。震惊百里，不丧匕鬯。洊雷，震。君子以恐惧修省。",
            unicode"其背，不获其身；行其庭，不见其人，无咎。兼山，艮。君子以思不出其位。",
            unicode"女归吉。利贞。山上有木，渐。君子以居贤德，善俗。",
            unicode"征凶。无攸利。泽上有雷，归妹。君子以终始有常。",
            unicode"亨。王假之，勿忧，宜日中。雷电，丰。君子以折狱致刑。",
            unicode"小亨。旅贞吉。山上有火，旅。君子以明慎用刑，而不留狱。",
            unicode"小亨。利有攸往，利见大人。随风，巽。君子以申命行事。",
            unicode"亨，利贞。丽泽，兑。君子以朋友讲习。",
            unicode"亨。王假有庙。利涉大川。利贞。风行水上，涣。先王以享于帝，立庙。",
            unicode"亨。苦节不可贞。水泽，节。君子以制数度，议德行。",
            unicode"豚鱼，吉。利涉大川，利贞。泽上有风，中孚。君子以议狱缓死。",
            unicode"亨，利贞。可小事，不可大事。飞鸟遗之音，不宜上，宜下，大吉。山上有雷，小过。君子以行过乎恭，丧过乎哀，用过乎俭。",
            unicode"亨小，利贞。初吉，终乱。水在火上，既济。君子以思患而豫防之。",
            unicode"亨。小狐汔济，濡其尾，无攸利。火在水上，未济。君子以慎辨物居方。"
        ];
    }

    function _initPinyins() private {
        _hexagramPinyins = [
            unicode"qián wéi tiān",
            unicode"kūn wéi dì",
            unicode"shuǐ léi zhūn",
            unicode"shān shuǐ méng",
            unicode"shuǐ tiān xū",
            unicode"tiān shuǐ sòng",
            unicode"dì shuǐ shī",
            unicode"shuǐ dì bǐ",
            unicode"fēng tiān xiǎo chù",
            unicode"tiān zé lǚ",
            unicode"dì tiān tài",
            unicode"tiān dì pǐ",
            unicode"tiān huǒ tóng rén",
            unicode"huǒ tiān dà yǒu",
            unicode"dì shān qiān",
            unicode"léi dì yù",
            unicode"zé léi suí",
            unicode"shān fēng gǔ",
            unicode"zé dì lín",
            unicode"dì fēng guān",
            unicode"huǒ léi shì kè",
            unicode"shān huǒ bì",
            unicode"shān dì bō",
            unicode"dì léi fù",
            unicode"tiān léi wú wàng",
            unicode"shān tiān dà xù",
            unicode"shān léi yí",
            unicode"zé fēng dà guò",
            unicode"kǎn wéi shuǐ",
            unicode"lí wéi huǒ",
            unicode"zé shān xián",
            unicode"léi fēng héng",
            unicode"tiān shān dùn",
            unicode"léi tiān dà zhuàng",
            unicode"huǒ dì jìn",
            unicode"dì huǒ míng yí",
            unicode"fēng huǒ jiā rén",
            unicode"huǒ zé kuí",
            unicode"shuǐ shān jiǎn",
            unicode"léi shuǐ xiè",
            unicode"shān zé sǔn",
            unicode"fēng léi yì",
            unicode"zé tiān guài",
            unicode"tiān fēng gòu",
            unicode"zé dì cuì",
            unicode"dì fēng shēng",
            unicode"zé shuǐ kùn",
            unicode"shuǐ fēng jǐng",
            unicode"zé huǒ gé",
            unicode"huǒ fēng dǐng",
            unicode"zhèn wéi léi",
            unicode"gèn wéi shān",
            unicode"fēng shān jiàn",
            unicode"léi zé guī mèi",
            unicode"léi huǒ fēng",
            unicode"huǒ shān lǚ",
            unicode"xùn wéi fēng",
            unicode"duì wéi zé",
            unicode"fēng shuǐ huàn",
            unicode"shuǐ zé jié",
            unicode"fēng zé zhōng fú",
            unicode"léi shān xiǎo guò",
            unicode"shuǐ huǒ jì jì",
            unicode"huǒ shuǐ wèi jì"
        ];
    }

    function _initShortNames() private {
        _hexagramShortNames = [
            unicode"乾",
            unicode"坤",
            unicode"屯",
            unicode"蒙",
            unicode"需",
            unicode"讼",
            unicode"师",
            unicode"比",
            unicode"小畜",
            unicode"履",
            unicode"泰",
            unicode"否",
            unicode"同人",
            unicode"大有",
            unicode"谦",
            unicode"豫",
            unicode"随",
            unicode"蛊",
            unicode"临",
            unicode"观",
            unicode"噬嗑",
            unicode"贲",
            unicode"剥",
            unicode"复",
            unicode"无妄",
            unicode"大畜",
            unicode"颐",
            unicode"大过",
            unicode"坎",
            unicode"离",
            unicode"咸",
            unicode"恒",
            unicode"遯",
            unicode"大壮",
            unicode"晋",
            unicode"明夷",
            unicode"家人",
            unicode"睽",
            unicode"蹇",
            unicode"解",
            unicode"损",
            unicode"益",
            unicode"夬",
            unicode"姤",
            unicode"萃",
            unicode"升",
            unicode"困",
            unicode"井",
            unicode"革",
            unicode"鼎",
            unicode"震",
            unicode"艮",
            unicode"渐",
            unicode"归妹",
            unicode"丰",
            unicode"旅",
            unicode"巽",
            unicode"兑",
            unicode"涣",
            unicode"节",
            unicode"中孚",
            unicode"小过",
            unicode"既济",
            unicode"未济"
        ];
    }

    function _initShortNamePinyins() private {
        _hexagramShortNamePinyins = [
            unicode"Qian",
            unicode"Kun",
            unicode"Zhun",
            unicode"Meng",
            unicode"Xu",
            unicode"Song",
            unicode"Shi",
            unicode"Bi",
            unicode"Xiaoxu",
            unicode"Lv",
            unicode"Tai",
            unicode"Pi",
            unicode"Tongren",
            unicode"Dayou",
            unicode"Qian",
            unicode"Yu",
            unicode"Sui",
            unicode"Gu",
            unicode"Lin",
            unicode"Guan",
            unicode"Shike",
            unicode"Bi",
            unicode"Bo",
            unicode"Fu",
            unicode"Wuwang",
            unicode"Daxu",
            unicode"Yi",
            unicode"Daguo",
            unicode"Kan",
            unicode"Li",
            unicode"Xian",
            unicode"Heng",
            unicode"Dun",
            unicode"Dazhuang",
            unicode"Jin",
            unicode"Mingyi",
            unicode"Jiaren",
            unicode"Kui",
            unicode"Jian",
            unicode"Xie",
            unicode"Sun",
            unicode"Yi",
            unicode"Guai",
            unicode"Gou",
            unicode"Cui",
            unicode"Sheng",
            unicode"Kun",
            unicode"Jing",
            unicode"Ge",
            unicode"Ding",
            unicode"Zhen",
            unicode"Gen",
            unicode"Jian",
            unicode"Guimei",
            unicode"Feng",
            unicode"Lv",
            unicode"Xun",
            unicode"Dui",
            unicode"Huan",
            unicode"Jie",
            unicode"Zhongfu",
            unicode"Xiaoguo",
            unicode"Jiji",
            unicode"Weiji"
        ];
    }
}
