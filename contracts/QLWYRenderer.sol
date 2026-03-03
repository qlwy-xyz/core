// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

interface IQLWYFortuneCoreView {
    struct TokenView {
        uint8 rarity;
        uint8 luck;
        uint8[6] lines;
        uint16 id;
    }

    function tokenView(uint256 tokenId) external view returns (TokenView memory);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

interface IQLWYContentPack {
    function hexagramName(uint16 id) external view returns (string memory);
    function hexagramJudgment(uint16 id) external view returns (string memory);
    function hexagramPinyin(uint16 id) external view returns (string memory);
    function hexagramShortName(uint16 id) external view returns (string memory);
    function hexagramShortNamePinyin(uint16 id) external view returns (string memory);
    
    function rarityLabel(uint8 rarity) external view returns (string memory);
    function bgColor(uint8 rarity) external view returns (string memory);
    function strokeColor(uint8 rarity) external view returns (string memory);

    function imageUri(uint16 id, uint8 rarity, uint8 luck) external view returns (string memory);
    function fontStyleTag() external view returns (string memory);
}

/// @title QLWYRenderer
/// @notice On-chain SVG renderer for 潜龙勿用 fortune NFTs.
contract QLWYRenderer is Ownable {
    using Strings for uint256;

    IQLWYFortuneCoreView public core;
    IQLWYContentPack public pack;
    string public language = "zh-CN";

    event CoreUpdated(address indexed core);
    event PackUpdated(address indexed pack);
    event LanguageUpdated(string language);

    constructor(address owner_, IQLWYFortuneCoreView core_, IQLWYContentPack pack_) Ownable(owner_) {
        core = core_;
        pack = pack_;
    }

    function setCore(IQLWYFortuneCoreView core_) external onlyOwner {
        core = core_;
        emit CoreUpdated(address(core_));
    }

    function setPack(IQLWYContentPack pack_) external onlyOwner {
        pack = pack_;
        emit PackUpdated(address(pack_));
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        IQLWYFortuneCoreView.TokenView memory view_ = core.tokenView(tokenId);
        string memory name = _buildName(tokenId, view_);
        string memory description = _buildDescription(view_);
        string memory attributes = _buildAttributes(view_);
        // string memory image = _buildImage(view_, tokenId);
        string memory image = pack.imageUri(view_.id, view_.rarity, view_.luck);

        bytes memory json = abi.encodePacked(
            '{"name":"',
            name,
            '","description":"',
            description,
            '","image":"',
            image,
            '","attributes":',
            attributes,
            "}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    // ---------------------------------------------------------------------
    // Internal builders
    // ---------------------------------------------------------------------

    function _buildName(uint256 tokenId, IQLWYFortuneCoreView.TokenView memory view_)
        internal
        view
        returns (string memory)
    {
        string memory hexName = pack.hexagramName(view_.id);
        return string.concat("QLWY #", tokenId.toString(), unicode" · ", hexName);
    }

    function _buildDescription(IQLWYFortuneCoreView.TokenView memory view_) internal view returns (string memory) {
        string memory judgment = pack.hexagramJudgment(view_.id);
        return judgment;
    }

    function _buildAttributes(IQLWYFortuneCoreView.TokenView memory view_) internal view returns (string memory) {
        string memory rarityLabel = pack.rarityLabel(view_.rarity);
        string memory baseName = pack.hexagramName(view_.id);

        bytes memory attrs = abi.encodePacked(
            '[{"trait_type":"Rarity","value":"',
            rarityLabel,
            '"},',
            '{"trait_type":"Luck","value":',
            Strings.toString(view_.luck),
            '},',
            '{"trait_type":"Hexagram","value":"',
            baseName,
            '"}]'
        );
        return string(attrs);
    }

    function _buildImage(IQLWYFortuneCoreView.TokenView memory view_, uint256 tokenId)
        internal
        view
        returns (string memory)
    {
        string memory svg = _buildSVG(view_, tokenId);
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    function _buildSVG(IQLWYFortuneCoreView.TokenView memory v, uint256 /*tokenId*/)
        internal view returns (string memory)
    {
        // —— Layout constants —— //
        uint256 W = 900;
        uint256 H = 1400;
        uint256 PADDING = 48;

        uint256 I_TOP = 60;
        uint256 I_LEFT = 60;
        uint256 I_W = W - 2 * I_LEFT; // 780
        uint256 I_H = 460;
        uint256 SCALLOP = 56;
        uint256 BLEED = 14; // 出血，防止边缘露缝
        uint256 OUTER_OFFSET = 12;

        uint256 TITLE_X = 140;
        uint256 TITLE_Y = 640;
        uint256 TITLE_BLOCK_MAX = 480;
        uint256 TITLE_FONT_MIN = 120;
        uint256 TITLE_FONT_MAX = 196;

        uint256 BODY_RIGHT_X = 660;
        uint256 BODY_TOP_Y = 640;
        uint256 BODY_FONT = 34;
        uint256 BODY_STEP = 46;
        uint256 COLUMN_GAP_LOOSE = 82;
        uint256 COLUMN_GAP_TIGHT = 58;

        uint256 INFO_LEFT = PADDING;
        uint256 INFO_BASE_Y = H - PADDING - 38;
        uint256 ICON_BASE_Y = INFO_BASE_Y + 12;
        uint256 ICON_W = 64;
        uint256 ICON_THICK = 5;
        uint256 ICON_STEP = 5;
        uint256 ICON_MID = 6;

        uint256 LUCK_RADIUS = 60;
        uint256 LUCK_CX = W - PADDING - LUCK_RADIUS;
        uint256 LUCK_CY = INFO_BASE_Y - 40;

        uint256 DECO_SIZE = 840;

        // —— Colors —— //
        string memory BG = "#ffffff";
        string memory FRAME = pack.strokeColor(v.rarity);
        string memory ACCENT = pack.bgColor(v.rarity);
        string memory INK = "#3a2a1f";
        string memory BODY = "#585657";
        string memory INFO_CN = "#838579";
        string memory INFO_EN = "#b5b4b2";
        string memory DECO = FRAME;

        // —— Content —— //
        string memory full = pack.hexagramName(v.id);
        string memory py = pack.hexagramPinyin(v.id);
        string memory shortCN = pack.hexagramShortName(v.id);
        string memory shortEN = pack.hexagramShortNamePinyin(v.id);
        string memory judgment = pack.hexagramJudgment(v.id);

        // —— Pieces —— //
        string memory style = pack.fontStyleTag();
        string memory cardPath = _scallopedRectPath(I_LEFT, I_TOP, I_W, I_H, SCALLOP);

        string memory lineArt = string.concat(
            '<defs>',
                '<clipPath id="clipCard"><path d="', cardPath, '"/></clipPath>',
                '<filter id="decoBlur" x="-20%" y="-20%" width="140%" height="140%">',
                    '<feGaussianBlur stdDeviation="12"/>',
                '</filter>',
            '</defs>',
            _decoLayer(DECO, DECO_SIZE, W - PADDING, H - PADDING, _firstChar(full)),
            '<path d="', cardPath, '" fill="', BG, '" stroke="', FRAME, 
            '" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>',
            '<g clip-path="url(#clipCard)">',
                '<rect x="', _u(I_LEFT - BLEED), '" y="', _u(I_TOP - BLEED),
                '" width="', _u(I_W + 2 * BLEED), '" height="', _u(I_H + 2 * BLEED),
                '" fill="', ACCENT, '"/>',
                '<image x="', _u(I_LEFT - BLEED), '" y="', _u(I_TOP - BLEED),
                '" width="', _u(I_W + 2 * BLEED), '" height="', _u(I_H + 2 * BLEED),
                '" opacity="0" preserveAspectRatio="xMidYMid slice" href="', pack.imageUri(v.id, v.rarity, v.luck), '">',
                    '<animate attributeName="opacity" from="0" to="1" dur="0.8s" fill="freeze"/>',
                '</image>',
            '</g>'
        );

        string memory title = _verticalTitleWithPinyin(
            full, py, TITLE_X, TITLE_Y, TITLE_BLOCK_MAX, TITLE_FONT_MIN, TITLE_FONT_MAX, INK
        );

        string memory bodyCols = _bodyColumns(
            judgment, BODY_RIGHT_X, BODY_TOP_Y, BODY_FONT, BODY_STEP, COLUMN_GAP_LOOSE, COLUMN_GAP_TIGHT, BODY
        );

        string memory outerBorder = string.concat(
            '<g id="outer-border">',
                '<rect x="', _u(OUTER_OFFSET), '" y="', _u(OUTER_OFFSET),
                '" width="', _u(W - OUTER_OFFSET * 2), '" height="', _u(H - OUTER_OFFSET * 2),
                '" rx="60" ry="60" fill="#ffffff" stroke="', FRAME, '" stroke-opacity="0.08" stroke-width="4"/>',
            '</g>'
        );

        string memory luckBadge = string.concat(
            '<g id="luck-badge">',
                '<circle cx="', _u(LUCK_CX), '" cy="', _u(LUCK_CY), '" r="', _u(LUCK_RADIUS),
                '" fill="', ACCENT, '" fill-opacity="0.6" stroke="', FRAME, 
                '" stroke-opacity="0.2" stroke-width="4"/>',
                _textXY(
                    _u(v.luck),
                    _u(LUCK_CX),
                    _u(LUCK_CY),
                    "middle",
                    "48",
                    INK,
                    _bodyFontStack(),
                    'dominant-baseline="middle"'
                ),
            "</g>"
        );

        string memory infoBlock = string.concat(
            _hexIcon(v.lines, INFO_LEFT, ICON_BASE_Y, ICON_W, ICON_THICK, ICON_STEP, ICON_MID, FRAME),
            _textXY(
                string.concat(unicode"第", _u(v.id), unicode"卦 · ", shortCN, unicode"卦"),
                _u(INFO_LEFT + ICON_W + 12), _u(INFO_BASE_Y - 18),
                "start", "28", INFO_CN, _bodyFontStack(), ""
            ),
            _textXY(
                string.concat("Hexagram ", _u(v.id), unicode" · ", shortEN),
                _u(INFO_LEFT + ICON_W + 12), _u(INFO_BASE_Y + 8),
                "start", "18", INFO_EN, _bodyFontStack(), ""
            )
        );

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="', _u(W), '" height="', _u(H),
            '" viewBox="0 0 ', _u(W), ' ', _u(H), '">',
                "<defs>", style,"</defs>",
                outerBorder,
                lineArt,
                title,
                bodyCols,
                luckBadge,
                '<g id="info-left">', infoBlock, "</g>",
            "</svg>"
        );
    }


    // ------------------- Layout helpers -------------------

    function _decoLayer(string memory color, uint256 size, uint256 x, uint256 y, string memory glyph)
        internal pure returns (string memory)
    {
        return string.concat(
            '<g opacity="0.08" pointer-events="none">',
              '<text x="', _u(x), '" y="', _u(y), '" text-anchor="end" dominant-baseline="ideographic" ',
              'font-size="', _u(size), '" fill="', color, '" font-family="', _titleFontStack(), '" filter="url(#decoBlur)">',
              _escapeText(glyph), "</text>",
            "</g>"
        );
    }

    function _scallopedRectPath(uint256 x, uint256 y, uint256 width, uint256 height, uint256 scallop)
        internal pure returns (string memory)
    {
        uint256 r = scallop / 2;
        uint256 left = x;
        uint256 top = y;
        uint256 right = x + width;
        uint256 bottom = y + height;
        return string.concat(
            "M ", _u(left + scallop), " ", _u(top),
            " H ", _u(right - scallop),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(right - r), " ", _u(top + r),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(right), " ", _u(top + scallop),
            " V ", _u(bottom - scallop),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(right - r), " ", _u(bottom - r),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(right - scallop), " ", _u(bottom),
            " H ", _u(left + scallop),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(left + r), " ", _u(bottom - r),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(left), " ", _u(bottom - scallop),
            " V ", _u(top + scallop),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(left + r), " ", _u(top + r),
            " A ", _u(r), " ", _u(r), " 0 0 1 ", _u(left + scallop), " ", _u(top),
            " Z"
        );
    }

    function _hexIcon(
        uint8[6] memory lines, uint256 xLeft, uint256 baseY, uint256 W, uint256 thick, uint256 step, uint256 midGap, string memory color
    ) internal pure returns (string memory out_)
    {
        uint256 totalH = thick * 6 + step * 5;
        uint256 topY = baseY - totalH;
        for (uint256 i = 0; i < 6; i++) {
            uint8 bit = lines[5 - i];
            uint256 y = topY + i * (thick + step);
            if (bit == 1) {
                out_ = string.concat(out_, _rect(xLeft, y, W, thick, 2, color));
            } else {
                uint256 seg = (W - midGap) / 2;
                out_ = string.concat(out_, _rect(xLeft, y, seg, thick, 2, color));
                out_ = string.concat(out_, _rect(xLeft + W - seg, y, seg, thick, 2, color));
            }
        }
    }

    function _verticalTitleWithPinyin(
        string memory full, string memory pinyin, uint256 X, uint256 Y, uint256 blockMax, uint256 minSize, uint256 maxSize, string memory color
    ) internal pure returns (string memory out_)
    {
        string[] memory chars = _splitGraphemes(full);
        string[] memory pys = _split(pinyin, " ");
        uint256 n = chars.length;

        uint256 gapRatioNum = 8; uint256 base = 144;
        uint256 effectiveUnits = n + (gapRatioNum * (n > 0 ? (n - 1) : 0)) / base;
        uint256 fontSize = _clamp(minSize, blockMax / (effectiveUnits == 0 ? 1 : effectiveUnits), maxSize);
        uint256 gap = (fontSize * gapRatioNum) / base;

        int256 oddOffset = -16;
        int256 evenOffset = 12;
        uint256 y = Y;

        for (uint256 i = 0; i < n; i++) {
            bool odd = (i % 2 == 0);
            uint256 fz = odd ? (fontSize * 108 / 100) : (fontSize * 90 / 100);
            int256 x = int256(X) + (odd ? oddOffset : evenOffset);
            uint256 ux = x < 0 ? 0 : uint256(x);
            out_ = string.concat(
                out_,
                '<text x="', _u(ux), '" y="', _u(y),
                '" font-size="', _u(fz), '" fill="', color,
                '" font-family="', _titleFontStack(),
                '" writing-mode="tb" glyph-orientation-vertical="0">',
                _escapeText(chars[i]), "</text>"
            );
   
            if (i < pys.length && bytes(pys[i]).length > 0) {
                int256 px = x + (odd ? int256(5) : int256(int256(fz) / 5));
                if (px < 0) px = 0;
                uint256 py = y + 2;
                out_ = string.concat(
                    out_,
                    '<text x="', _u(uint256(px)), '" y="', _u(py),
                    '" font-size="22" fill="#acacac" font-family="', _bodyFontStack(),
                    '" text-anchor="', (odd ? "end" : "start"), '">',
                    _escapeText(pys[i]), "</text>"
                );
            }
            y += fz + gap;
        }
    }

    /// @dev Splits `s` on literal '\n' sequences (0x5c 0x6e) or newline bytes (0x0a).
    function _splitByN(string memory s) internal pure returns (string[] memory) {
        bytes memory data = bytes(s);
        if (data.length == 0) {
            return new string[](0);
        }

        uint256 estimate = 1;
        for (uint256 i = 0; i < data.length;) {
            if (data[i] == 0x0A) {
                estimate++;
                i++;
            } else if (data[i] == 0x5C && i + 1 < data.length && data[i + 1] == 0x6E) {
                estimate++;
                i += 2;
            } else {
                i++;
            }
        }

        string[] memory tmp = new string[](estimate);
        uint256 start = 0;
        uint256 count = 0;

        for (uint256 i = 0; i < data.length;) {
            if (data[i] == 0x0A) {
                if (i > start) {
                    tmp[count++] = _sliceSegment(data, start, i);
                }
                i++;
                start = i;
            } else if (data[i] == 0x5C && i + 1 < data.length && data[i + 1] == 0x6E) {
                if (i > start) {
                    tmp[count++] = _sliceSegment(data, start, i);
                }
                i += 2;
                start = i;
            } else {
                i++;
            }
        }

        if (start < data.length) {
            tmp[count++] = _sliceSegment(data, start, data.length);
        }

        if (count == tmp.length) {
            return tmp;
        }

        string[] memory out = new string[](count);
        for (uint256 i = 0; i < count; i++) {
            out[i] = tmp[i];
        }
        return out;
    }

    function _sliceSegment(bytes memory data, uint256 start, uint256 end) private pure returns (string memory) {
        if (end <= start) {
            return "";
        }

        bytes memory slice = new bytes(end - start);
        for (uint256 i = 0; i < slice.length; i++) {
            slice[i] = data[start + i];
        }
        return string(slice);
    }

    function _bodyColumns(
        string memory text, uint256 rightX, uint256 topY, uint256 fontSize, uint256 step, uint256 gapLoose, uint256 gapTight, string memory color
    ) internal pure returns (string memory out_)
    {
        string[] memory rows = _splitByN(text);
      
        uint256 count;
        for (uint256 i=0;i<rows.length;i++) {
            if (bytes(rows[i]).length > 0) count++;
        }
        string[] memory cols = new string[](count);
        uint256 idx;
        for (uint256 i=0;i<rows.length;i++) {
            string memory t = rows[i];
            if (bytes(t).length>0) cols[idx++] = t;
        }
        if (cols.length == 0) {
            cols = new string[](1);
            cols[0] = text;
        }

        uint256 n = cols.length;
        uint256 gap = n >= 4 ? gapTight : gapLoose;
        int256 shift = n > 4 ? int256((n - 4) * gap / 2) : int256(0);

        for (uint256 i = 0; i < n; i++) {
            uint256 x = uint256(int256(rightX) + shift) - i * gap;
            out_ = string.concat(
                out_,
                _verticalTextSpans(cols[i], _u(x), _u(topY), _u(fontSize), color, step)
            );
        }
    }

    function _verticalTextSpans(
        string memory s,
        string memory x,
        string memory y,
        string memory fontSize,
        string memory color,
        uint256 step
    ) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 baseY = _parseUint(y);

        uint256 i = 0;
        uint256 n = 0;
        while (i < b.length) {
            i += _utf8GlyphLen(b, i);
            n++;
        }

        bytes[] memory chunks = new bytes[](n);
        i = 0;
        uint256 dy = 0;
        for (uint256 k = 0; k < n; k++) {
            uint256 glen = _utf8GlyphLen(b, i);

            bytes memory g = new bytes(glen);
            for (uint256 j = 0; j < glen; j++) g[j] = b[i + j];
            i += glen;

            string memory safe = _escapeText(string(g));

            chunks[k] = abi.encodePacked(
                '<tspan x="', x, '" y="', _u(baseY + dy), '">', safe, "</tspan>"
            );
            dy += step;
        }

        bytes memory spans = _joinBytes(chunks);

        return string(abi.encodePacked(
            '<text font-size="', fontSize, '" fill="', color,
            '" font-family="', _bodyFontStack(),
            '" writing-mode="vertical-rl">',
            spans,
            "</text>"
        ));
    }

    function _utf8GlyphLen(bytes memory b, uint256 i) internal pure returns (uint256) {
        uint8 x = uint8(b[i]);
        if (x < 0x80) return 1;
        if (x < 0xE0) return 2;
        if (x < 0xF0) return 3;
        return 4;
    }

    function _joinBytes(bytes[] memory parts) internal pure returns (bytes memory out) {
        uint256 total;
        for (uint256 i = 0; i < parts.length; i++) total += parts[i].length;

        out = new bytes(total);
        uint256 offset = 0;
        for (uint256 i = 0; i < parts.length; i++) {
            bytes memory p = parts[i];
            uint256 l = p.length;
            for (uint256 j = 0; j < l; j++) {
                out[offset + j] = p[j];
            }
            offset += l;
        }
    }

    // ------------------- Tiny SVG utils -------------------
    function _rect(uint256 x, uint256 y, uint256 w, uint256 h, uint256 rx, string memory fill)
        internal pure returns (string memory)
    {
        return string.concat(
            '<rect x="', _u(x), '" y="', _u(y),
            '" width="', _u(w), '" height="', _u(h),
            '" rx="', _u(rx), '" ry="', _u(rx),
            '" fill="', fill, '"/>'
        );
    }

    function _textXY(
        string memory s, string memory x, string memory y, string memory anchor, string memory size, string memory color, string memory font, string memory extra
    ) internal pure returns (string memory)
    {
        return string.concat(
            '<text x="', x, '" y="', y, '" text-anchor="', anchor,
            '" font-size="', size, '" fill="', color, '" font-family="', font, '" ', extra, ">", _escapeText(s), "</text>"
        );
    }

    // ------------------- Encoding / string helpers -------------------
    function _u(uint256 x) internal pure returns (string memory) {
        if (x == 0) return "0";
        uint256 y = x; uint256 len;
        while (y != 0) { len++; y /= 10; }
        bytes memory b = new bytes(len);
        while (x != 0) { b[--len] = bytes1(uint8(48 + x % 10)); x /= 10; }
        return string(b);
    }

    function _parseUint(string memory s) internal pure returns (uint256 v) {
        bytes memory b = bytes(s);
        for (uint256 i=0;i<b.length;i++) {
            uint8 c = uint8(b[i]);
            if (c >= 48 && c <= 57) {
                v = v * 10 + (c - 48);
            }
        }
    }

    function _firstChar(string memory s) public pure returns (string memory) {
        bytes memory b = bytes(s);
        require(b.length > 0, "Empty string");

        uint len;
        uint8 first = uint8(b[0]);

        if (first < 0x80) len = 1;
        else if (first < 0xE0) len = 2;
        else if (first < 0xF0) len = 3;
        else len = 4;

        require(b.length >= len, "Invalid UTF-8");
        bytes memory result = new bytes(len);
        for (uint i = 0; i < len; i++) {
            result[i] = b[i];
        }
        return string(result);
    }

    function _clamp(uint256 minV, uint256 v, uint256 maxV) internal pure returns (uint256) {
        return v < minV ? minV : (v > maxV ? maxV : v);
    }

    function _titleFontStack() internal pure returns (string memory) { return "LDQ, Noto Serif SC, STKaiti, KaiTi, serif"; }
    function _bodyFontStack()  internal pure returns (string memory) { return "FZQKB, Noto Serif SC, STSong, serif"; }

    function _escapeText(string memory value) internal pure returns (string memory) {
        bytes memory s = bytes(value);

        bytes[] memory parts = new bytes[](s.length * 2);
        uint256 idx;

        for (uint256 i = 0; i < s.length; i++) {
            bytes1 c = s[i];
            if (c == 0x26)      parts[idx++] = bytes("&amp;");   // &
            else if (c == 0x22) parts[idx++] = bytes("&quot;");  // "
            else if (c == 0x3c) parts[idx++] = bytes("&lt;");    // <
            else if (c == 0x3e) parts[idx++] = bytes("&gt;");    // >
            else                parts[idx++] = abi.encodePacked(c);
        }

        bytes[] memory used = new bytes[](idx);
        for (uint256 k = 0; k < idx; k++) used[k] = parts[k];
        return string(_joinBytes(used));
    }


    function _split(string memory s, string memory delim) internal pure returns (string[] memory) {
        bytes memory b = bytes(s); bytes memory d = bytes(delim);
        if (d.length == 0) {
            string[] memory single = new string[](1);
            single[0] = s;
            return single;
        }
        uint256 count; uint256 i;
        while (i + d.length <= b.length) {
            bool eq = true; for (uint256 k=0;k<d.length;k++) if (b[i+k]!=d[k]) { eq=false; break; }
            if (eq) { count++; i += d.length; } else { i++; }
        }
        string[] memory parts = new string[](count+1);
        uint256 idx; uint256 start; i=0;
        while (i + d.length <= b.length) {
            bool eq2 = true; for (uint256 k=0;k<d.length;k++) if (b[i+k]!=d[k]) { eq2=false; break; }
            if (eq2) {
                parts[idx++] = _slice(b, start, i);
                i += d.length;
                start = i;
            } else { i++; }
        }
        parts[idx] = _slice(b, start, b.length);
        return parts;
    }

    function _splitGraphemes(string memory s) internal pure returns (string[] memory) {
        bytes memory b = bytes(s);
        uint len = b.length;
        require(len > 0, "Empty string");

        uint charCount = 0;
        uint i = 0;
        while (i < len) {
            uint8 c = uint8(b[i]);
            if (c < 0x80) i += 1; 
            else if (c < 0xE0) i += 2;
            else if (c < 0xF0) i += 3;
            else i += 4;
            charCount++;
        }

        string[] memory chars = new string[](charCount);
        i = 0;
        uint index = 0;
        while (i < len) {
            uint8 c = uint8(b[i]);
            uint charLen;
            if (c < 0x80) charLen = 1;
            else if (c < 0xE0) charLen = 2;
            else if (c < 0xF0) charLen = 3;
            else charLen = 4;

            chars[index] = _slice(b, i, i + charLen);

            i += charLen;
            index++;
        }

        return chars;
    }

    function _slice(bytes memory data, uint256 start, uint256 end_) private pure returns (string memory) {
        if (end_ <= start) return "";
        bytes memory out = new bytes(end_ - start);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = data[start + i];
        }
        return string(out);
    }

}
