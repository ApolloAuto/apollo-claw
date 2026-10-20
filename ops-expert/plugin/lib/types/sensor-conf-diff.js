function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i] ?? '';
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (ch === '#' || text.startsWith('//', i)) {
            const end = text.indexOf('\n', i);
            i = end < 0 ? text.length : end + 1;
            continue;
        }
        if (text.startsWith('/*', i)) {
            const end = text.indexOf('*/', i + 2);
            if (end < 0)
                throw new Error('配置块注释未闭合');
            i = end + 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            const quote = ch;
            const start = ++i;
            let closed = false;
            while (i < text.length) {
                if (text[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (text[i] === quote) {
                    closed = true;
                    break;
                }
                i++;
            }
            if (!closed)
                throw new Error('配置字符串未闭合');
            tokens.push({ kind: 'string', value: text.slice(start, i) });
            i++;
        }
        else if ('{}<>[]:;,'.includes(ch)) {
            tokens.push({ kind: 'punct', value: ch });
            i++;
        }
        else {
            const start = i;
            while (i < text.length && !/[\s{}<>\[\]:;,"'#]/.test(text[i] ?? '')
                && !text.startsWith('//', i) && !text.startsWith('/*', i))
                i++;
            if (i === start)
                throw new Error(`无法识别配置字符，位置 ${i}`);
            tokens.push({ kind: 'bare', value: text.slice(start, i) });
        }
        if (tokens.length > 200_000)
            throw new Error('配置过大，无法生成字段对比');
    }
    return tokens;
}
export function confScalarFields(text) {
    const fields = [];
    // JSON references use actual object/array paths as well.
    if (/^\s*\{/.test(text)) {
        const walk = (value, path) => {
            if (Array.isArray(value))
                value.forEach((item, index) => walk(item, `${path}[${index}]`));
            else if (typeof value === 'object' && value !== null) {
                for (const [key, item] of Object.entries(value))
                    walk(item, path ? `${path}.${key}` : key);
            }
            else
                fields.push({ key: path, value: String(value) });
        };
        walk(JSON.parse(text), '');
        return fields;
    }
    const tokens = tokenize(text);
    let pos = 0;
    const peek = () => tokens[pos];
    const expect = (value) => {
        if (peek()?.value !== value)
            throw new Error(`配置结构不完整，预期 ${value}`);
        pos++;
    };
    const scalar = (path) => {
        const token = peek();
        if (token === undefined || token.kind === 'punct')
            throw new Error(`字段 ${path} 缺少标量值`);
        pos++;
        let value = token.value;
        if (token.kind === 'string') {
            while (peek()?.kind === 'string') {
                value += tokens[pos]?.value ?? '';
                pos++;
            }
        }
        fields.push({ key: path, value });
    };
    const message = (parent, closing, depth = 0) => {
        if (depth > 64)
            throw new Error('配置嵌套过深');
        const occurrences = new Map();
        while (pos < tokens.length && peek()?.value !== closing) {
            if (peek()?.value === ',' || peek()?.value === ';') {
                pos++;
                continue;
            }
            const field = peek();
            if (field?.kind !== 'bare' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.value)) {
                throw new Error(`配置字段名不合法：${field?.value ?? 'EOF'}`);
            }
            pos++;
            const base = parent ? `${parent}.${field.value}` : field.value;
            const allocate = () => {
                const index = occurrences.get(field.value) ?? 0;
                occurrences.set(field.value, index + 1);
                return index === 0 ? base : `${base}[${index}]`;
            };
            if (peek()?.value === ':')
                pos++;
            const value = (path) => {
                const open = peek()?.value;
                if (open === '{' || open === '<') {
                    pos++;
                    const close = open === '{' ? '}' : '>';
                    message(path, close, depth + 1);
                    expect(close);
                }
                else
                    scalar(path);
            };
            if (peek()?.value === '[') {
                pos++;
                while (peek()?.value !== ']') {
                    value(allocate());
                    if (peek()?.value !== ']')
                        expect(',');
                }
                expect(']');
            }
            else
                value(allocate());
        }
    };
    message('');
    return fields;
}
//# sourceMappingURL=sensor-conf-diff.js.map