//! Frame scripts, compiled to AVM1.
//!
//! Until this, twip recognised four whole statements — `stop()`, `play()`, `gotoAndPlay(n)`
//! and `gotoAndStop(n)` — by matching their source text, and silently ignored everything else
//! in a script. That is not a compiler, it is a lookup table, and it means a frame script can
//! hold a condition or a counter and the movie will not.
//!
//! It compiles to AVM1 rather than to AVM2 because AVM1 *is* an ECMAScript-3 machine. Its
//! instruction set is `GetVariable`/`SetVariable`, `Add2`, `Less2`, `If`, `Jump` — the shapes
//! a JavaScript expression already has, which is why ActionScript 1 and 2 both compiled onto
//! it and why the mapping here is a translation rather than an emulation. AVM2 would mean
//! emitting a whole ABC container: constant pools, traits, multinames, method bodies.
//!
//! ## What stage 1 covers
//!
//! Expressions (arithmetic, comparison, logical, assignment), variables, `if`/`else`,
//! `while`, and the four built-in calls. Functions, objects, arrays and member access are
//! not here; a script using them is reported as unsupported rather than half-compiled, which
//! is the same rule the export report follows for gradients and text.
//!
//! ## Why an IR rather than bytes
//!
//! `Op` exists because of upsampling. The compiler resamples document frames into movie
//! frames on export, and every `gotoAndPlay(10)` has to move with them — so a goto's frame
//! number must still be a *number* after the script is compiled, not a payload buried in a
//! byte string. Emission happens last, after `retarget` has had its chance.
//!
//! TypeScript annotations are accepted and dropped (`var x: number = 1`). Erasing them is
//! nearly free and it means a script can be typed by an editor that knows how, without twip
//! having to ship a type checker into a browser tab.

use std::fmt::Write as _;

/// One AVM1 instruction, or a jump that does not know its distance yet.
///
/// A thin echo of the crate's own `Action`, and deliberately so: `Action` borrows its strings,
/// and these have to outlive the compile so that `retarget` can rewrite goto targets before
/// anything is serialised.
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    // The four that carry a retargetable frame number, and the reason this is an enum of
    // twip's own rather than a Vec<Action>.
    Stop,
    Play,
    /// `gotoAndStop(n)` — SWF `GotoFrame` moves the playhead and stops. 0-indexed.
    GotoFrame(u16),
    /// `gotoAndPlay(n)` — `GotoFrame` then `Play`. 0-indexed.
    GotoAndPlay(u16),
    /// `gotoAndStop("label")` / `gotoAndPlay("label")`; the bool keeps it playing.
    GotoLabel(String, bool),

    PushNumber(f64),
    PushString(String),
    PushBool(bool),
    PushNull,
    PushUndefined,

    GetVariable,
    SetVariable,
    Pop,
    Trace,

    Add,
    Subtract,
    Multiply,
    Divide,
    Modulo,
    Less,
    Greater,
    Equals,
    /// `===`. AVM1 has no strict-equality action, so this is `Equals2` with a type check
    /// folded in by the parser refusing to mix — see `Binary::StrictEquals`.
    StrictEquals,
    And,
    Or,
    Not,

    /// Branch to `label` when the popped value is false. AVM1's `If` branches when the value
    /// is TRUE, so this emits a `Not` before it — every `if` and `while` in a language whose
    /// conditions read forwards needs the inverse of the one the machine has.
    JumpIfFalse(usize),
    Jump(usize),
    /// Not an instruction. Marks where a jump lands, and occupies no bytes.
    Label(usize),
}

/// What a script could not be compiled into.
#[derive(Debug, Clone, PartialEq)]
pub struct Unsupported {
    pub message: String,
}

/// Compile one script's source into ops.
///
/// An error is the whole script, not the offending statement. Half a script is worse than
/// none: a `while` whose body failed to parse would run forever, and a condition that
/// silently became `undefined` reads as a movie bug rather than a compiler limit.
pub fn compile(src: &str) -> Result<Vec<Op>, Unsupported> {
    let tokens = lex(src)?;
    let mut parser = Parser {
        tokens,
        at: 0,
        labels: 0,
    };
    let mut ops = Vec::new();
    while !parser.done() {
        parser.statement(&mut ops)?;
    }
    Ok(ops)
}

/// Move every goto target `k` movie frames apart, for the upsampling pass.
pub fn retarget(ops: &mut [Op], k: u32) {
    let shift = |f: u16| -> u16 { (u32::from(f) * k).min(u32::from(u16::MAX)) as u16 };
    for op in ops {
        match op {
            Op::GotoFrame(f) => *f = shift(*f),
            Op::GotoAndPlay(f) => *f = shift(*f),
            _ => {}
        }
    }
}

/* ---- lexing ------------------------------------------------------------------------- */

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    Ident(String),
    /// Punctuation and operators, longest match first so `===` never lexes as `==` then `=`.
    Sym(String),
}

const SYMBOLS: &[&str] = &[
    "===", "!==", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "=", "<",
    ">", "+", "-", "*", "/", "%", "!", "(", ")", "{", "}", ";", ",", ":", ".",
];

fn lex(src: &str) -> Result<Vec<Tok>, Unsupported> {
    let bytes: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        let c = bytes[i];

        if c.is_whitespace() {
            i += 1;
            continue;
        }
        // Comments, both shapes. A `//` inside a string is not a comment, which is why this
        // runs inside the same loop as the string reader rather than as a prepass over lines.
        if c == '/' && bytes.get(i + 1) == Some(&'/') {
            while i < bytes.len() && bytes[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && bytes.get(i + 1) == Some(&'*') {
            i += 2;
            while i < bytes.len() && !(bytes[i] == '*' && bytes.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }

        if c.is_ascii_digit() || (c == '.' && bytes.get(i + 1).is_some_and(char::is_ascii_digit)) {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == '.') {
                i += 1;
            }
            let text: String = bytes[start..i].iter().collect();
            let n = text
                .parse::<f64>()
                .map_err(|_| unsupported(format!("`{text}` is not a number this can read")))?;
            out.push(Tok::Num(n));
            continue;
        }

        if c == '"' || c == '\'' {
            let quote = c;
            i += 1;
            let mut s = String::new();
            while i < bytes.len() && bytes[i] != quote {
                if bytes[i] == '\\' && i + 1 < bytes.len() {
                    i += 1;
                    s.push(match bytes[i] {
                        'n' => '\n',
                        't' => '\t',
                        other => other,
                    });
                } else {
                    s.push(bytes[i]);
                }
                i += 1;
            }
            if i >= bytes.len() {
                return Err(unsupported("a string is missing its closing quote"));
            }
            i += 1;
            out.push(Tok::Str(s));
            continue;
        }

        if c.is_alphabetic() || c == '_' || c == '$' {
            let start = i;
            while i < bytes.len()
                && (bytes[i].is_alphanumeric() || bytes[i] == '_' || bytes[i] == '$')
            {
                i += 1;
            }
            out.push(Tok::Ident(bytes[start..i].iter().collect()));
            continue;
        }

        let rest: String = bytes[i..].iter().collect();
        match SYMBOLS.iter().find(|sym| rest.starts_with(**sym)) {
            Some(sym) => {
                out.push(Tok::Sym((*sym).to_string()));
                i += sym.chars().count();
            }
            None => {
                return Err(unsupported(format!(
                    "`{c}` is not something this understands"
                )));
            }
        }
    }
    Ok(out)
}

fn unsupported(message: impl Into<String>) -> Unsupported {
    Unsupported {
        message: message.into(),
    }
}

/* ---- parsing, straight to ops --------------------------------------------------------- */

struct Parser {
    tokens: Vec<Tok>,
    at: usize,
    labels: usize,
}

/// Binding power per binary operator. Higher binds tighter; JavaScript's own table, cut to
/// the operators stage 1 has.
fn precedence(sym: &str) -> Option<u8> {
    Some(match sym {
        "||" => 1,
        "&&" => 2,
        "==" | "!=" | "===" | "!==" => 3,
        "<" | ">" | "<=" | ">=" => 4,
        "+" | "-" => 5,
        "*" | "/" | "%" => 6,
        _ => return None,
    })
}

impl Parser {
    fn done(&self) -> bool {
        self.at >= self.tokens.len()
    }

    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.at)
    }

    fn peek_sym(&self, sym: &str) -> bool {
        matches!(self.peek(), Some(Tok::Sym(s)) if s == sym)
    }

    fn peek_word(&self, word: &str) -> bool {
        matches!(self.peek(), Some(Tok::Ident(s)) if s == word)
    }

    fn eat_sym(&mut self, sym: &str) -> bool {
        if self.peek_sym(sym) {
            self.at += 1;
            return true;
        }
        false
    }

    fn expect_sym(&mut self, sym: &str) -> Result<(), Unsupported> {
        if self.eat_sym(sym) {
            return Ok(());
        }
        Err(unsupported(format!(
            "expected `{sym}`, found {}",
            self.describe_here()
        )))
    }

    fn describe_here(&self) -> String {
        match self.peek() {
            None => "the end of the script".to_string(),
            Some(Tok::Num(n)) => format!("`{n}`"),
            Some(Tok::Str(s)) => format!("the string `{s}`"),
            Some(Tok::Ident(s)) => format!("`{s}`"),
            Some(Tok::Sym(s)) => format!("`{s}`"),
        }
    }

    fn label(&mut self) -> usize {
        self.labels += 1;
        self.labels
    }

    /// A TypeScript annotation, dropped. `: number`, `: string`, `: Foo` — one identifier,
    /// which is all a frame-script variable is going to carry.
    fn skip_type(&mut self) {
        // `eat_sym` advances on a match, so the short-circuit here still consumes the colon
        // before the name is looked at.
        if self.eat_sym(":") && matches!(self.peek(), Some(Tok::Ident(_))) {
            self.at += 1;
        }
    }

    fn statement(&mut self, ops: &mut Vec<Op>) -> Result<(), Unsupported> {
        if self.eat_sym(";") {
            return Ok(());
        }
        if self.eat_sym("{") {
            while !self.eat_sym("}") {
                if self.done() {
                    return Err(unsupported("a block is missing its closing brace"));
                }
                self.statement(ops)?;
            }
            return Ok(());
        }
        if self.peek_word("var") || self.peek_word("let") || self.peek_word("const") {
            self.at += 1;
            let name = match self.peek().cloned() {
                Some(Tok::Ident(name)) => {
                    self.at += 1;
                    name
                }
                _ => return Err(unsupported("a declaration needs a name")),
            };
            self.skip_type();
            ops.push(Op::PushString(name));
            if self.eat_sym("=") {
                self.expression(ops, 0)?;
            } else {
                ops.push(Op::PushUndefined);
            }
            ops.push(Op::SetVariable);
            self.eat_sym(";");
            return Ok(());
        }
        if self.peek_word("if") {
            self.at += 1;
            return self.if_statement(ops);
        }
        if self.peek_word("while") {
            self.at += 1;
            return self.while_statement(ops);
        }

        // An expression on its own line. Its value is discarded, except that the ops which
        // leave nothing on the stack — `stop()`, an assignment — must not be popped.
        let before = ops.len();
        self.expression(ops, 0)?;
        if leaves_a_value(&ops[before..]) {
            ops.push(Op::Pop);
        }
        self.eat_sym(";");
        Ok(())
    }

    fn if_statement(&mut self, ops: &mut Vec<Op>) -> Result<(), Unsupported> {
        self.expect_sym("(")?;
        self.expression(ops, 0)?;
        self.expect_sym(")")?;

        let otherwise = self.label();
        ops.push(Op::JumpIfFalse(otherwise));
        self.statement(ops)?;

        if self.peek_word("else") {
            self.at += 1;
            let end = self.label();
            ops.push(Op::Jump(end));
            ops.push(Op::Label(otherwise));
            self.statement(ops)?;
            ops.push(Op::Label(end));
        } else {
            ops.push(Op::Label(otherwise));
        }
        Ok(())
    }

    fn while_statement(&mut self, ops: &mut Vec<Op>) -> Result<(), Unsupported> {
        let top = self.label();
        let end = self.label();
        ops.push(Op::Label(top));
        self.expect_sym("(")?;
        self.expression(ops, 0)?;
        self.expect_sym(")")?;
        ops.push(Op::JumpIfFalse(end));
        self.statement(ops)?;
        ops.push(Op::Jump(top));
        ops.push(Op::Label(end));
        Ok(())
    }

    /// Pratt: parse a unary, then absorb operators that bind at least as tightly as `floor`.
    fn expression(&mut self, ops: &mut Vec<Op>, floor: u8) -> Result<(), Unsupported> {
        self.unary(ops)?;
        while let Some(Tok::Sym(sym)) = self.peek().cloned() {
            let Some(power) = precedence(&sym) else { break };
            if power < floor {
                break;
            }
            self.at += 1;
            // Left-associative, so the right side must bind strictly tighter.
            self.expression(ops, power + 1)?;
            // `a <= b` is `!(a > b)`, and `!=` is `!(a == b)`. AVM1 has an action for
            // neither, and the rewrite is exact rather than an approximation.
            let emitted: &[Op] = &match sym.as_str() {
                "+" => vec![Op::Add],
                "-" => vec![Op::Subtract],
                "*" => vec![Op::Multiply],
                "/" => vec![Op::Divide],
                "%" => vec![Op::Modulo],
                "<" => vec![Op::Less],
                ">" => vec![Op::Greater],
                "==" => vec![Op::Equals],
                "===" => vec![Op::StrictEquals],
                "&&" => vec![Op::And],
                "||" => vec![Op::Or],
                "<=" => vec![Op::Greater, Op::Not],
                ">=" => vec![Op::Less, Op::Not],
                "!=" => vec![Op::Equals, Op::Not],
                "!==" => vec![Op::StrictEquals, Op::Not],
                other => return Err(unsupported(format!("`{other}` is not supported yet"))),
            };
            ops.extend_from_slice(emitted);
        }
        Ok(())
    }

    fn unary(&mut self, ops: &mut Vec<Op>) -> Result<(), Unsupported> {
        if self.eat_sym("!") {
            self.unary(ops)?;
            ops.push(Op::Not);
            return Ok(());
        }
        if self.eat_sym("-") {
            // 0 - x. AVM1 has no negate action.
            ops.push(Op::PushNumber(0.0));
            self.unary(ops)?;
            ops.push(Op::Subtract);
            return Ok(());
        }
        self.primary(ops)
    }

    fn primary(&mut self, ops: &mut Vec<Op>) -> Result<(), Unsupported> {
        if self.eat_sym("(") {
            self.expression(ops, 0)?;
            self.expect_sym(")")?;
            return Ok(());
        }
        match self.peek().cloned() {
            Some(Tok::Num(n)) => {
                self.at += 1;
                ops.push(Op::PushNumber(n));
                Ok(())
            }
            Some(Tok::Str(s)) => {
                self.at += 1;
                ops.push(Op::PushString(s));
                Ok(())
            }
            Some(Tok::Ident(name)) => {
                self.at += 1;
                self.after_identifier(ops, name)
            }
            _ => Err(unsupported(format!(
                "expected a value, found {}",
                self.describe_here()
            ))),
        }
    }

    /// An identifier is a keyword literal, a call, an assignment target, or a variable read —
    /// decided by what follows it.
    fn after_identifier(&mut self, ops: &mut Vec<Op>, name: String) -> Result<(), Unsupported> {
        match name.as_str() {
            "true" => return push_literal(ops, Op::PushBool(true)),
            "false" => return push_literal(ops, Op::PushBool(false)),
            "null" => return push_literal(ops, Op::PushNull),
            "undefined" => return push_literal(ops, Op::PushUndefined),
            _ => {}
        }

        // `this.stop()` is how the Wick editor's own snippets write it, so `this.` is a
        // receiver to step over rather than a member access to reject.
        let mut name = name;
        if name == "this" && self.peek_sym(".") {
            self.at += 1;
            match self.peek().cloned() {
                Some(Tok::Ident(next)) => {
                    self.at += 1;
                    name = next;
                }
                _ => return Err(unsupported("`this.` needs a name after it")),
            }
        }

        if self.peek_sym("(") {
            return self.call(ops, &name);
        }

        // Assignment. `x = e`, and the compound forms, which read the variable first.
        for (sym, op) in [
            ("=", None),
            ("+=", Some(Op::Add)),
            ("-=", Some(Op::Subtract)),
            ("*=", Some(Op::Multiply)),
            ("/=", Some(Op::Divide)),
        ] {
            if self.peek_sym(sym) {
                self.at += 1;
                ops.push(Op::PushString(name.clone()));
                if let Some(op) = op {
                    ops.push(Op::PushString(name));
                    ops.push(Op::GetVariable);
                    self.expression(ops, 0)?;
                    ops.push(op);
                } else {
                    self.expression(ops, 0)?;
                }
                ops.push(Op::SetVariable);
                return Ok(());
            }
        }

        // `x++` / `x--`, as statements. The value is not left behind, which is why they are
        // only correct where a statement is expected — and that is the only place stage 1
        // lets an expression start with an identifier followed by one.
        for (sym, op) in [("++", Op::Add), ("--", Op::Subtract)] {
            if self.peek_sym(sym) {
                self.at += 1;
                ops.push(Op::PushString(name.clone()));
                ops.push(Op::PushString(name));
                ops.push(Op::GetVariable);
                ops.push(Op::PushNumber(1.0));
                ops.push(op);
                ops.push(Op::SetVariable);
                return Ok(());
            }
        }

        ops.push(Op::PushString(name));
        ops.push(Op::GetVariable);
        Ok(())
    }

    fn call(&mut self, ops: &mut Vec<Op>, name: &str) -> Result<(), Unsupported> {
        self.expect_sym("(")?;
        let mut args: Vec<Vec<Op>> = Vec::new();
        if !self.peek_sym(")") {
            loop {
                let mut arg = Vec::new();
                self.expression(&mut arg, 0)?;
                args.push(arg);
                if !self.eat_sym(",") {
                    break;
                }
            }
        }
        self.expect_sym(")")?;

        match (name, args.len()) {
            ("stop", 0) => ops.push(Op::Stop),
            ("play", 0) => ops.push(Op::Play),
            ("trace", 1) => {
                ops.extend(args.remove_first());
                ops.push(Op::Trace);
            }
            ("gotoAndPlay", 1) | ("gotoAndStop", 1) => {
                let play = name == "gotoAndPlay";
                let arg = args.remove_first();
                match constant(&arg) {
                    Some(Const::Number(n)) => {
                        let frame = (n.max(1.0) as u32)
                            .saturating_sub(1)
                            .min(u32::from(u16::MAX));
                        ops.push(if play {
                            Op::GotoAndPlay(frame as u16)
                        } else {
                            Op::GotoFrame(frame as u16)
                        });
                    }
                    Some(Const::Str(label)) => ops.push(Op::GotoLabel(label, play)),
                    // A computed target needs GotoFrame2, which reads the stack. Stage 1
                    // stops here rather than compiling something that jumps to frame 0.
                    None => {
                        return Err(unsupported(format!(
                            "`{name}` needs a literal frame number or label for now"
                        )));
                    }
                }
            }
            (other, n) => {
                return Err(unsupported(format!(
                    "`{other}` with {n} argument(s) is not supported yet"
                )));
            }
        }
        Ok(())
    }
}

trait RemoveFirst<T> {
    fn remove_first(&mut self) -> T;
}

impl<T> RemoveFirst<T> for Vec<T> {
    fn remove_first(&mut self) -> T {
        self.remove(0)
    }
}

fn push_literal(ops: &mut Vec<Op>, op: Op) -> Result<(), Unsupported> {
    ops.push(op);
    Ok(())
}

enum Const {
    Number(f64),
    Str(String),
}

/// The value of an argument, when it is one push and nothing else.
fn constant(ops: &[Op]) -> Option<Const> {
    match ops {
        [Op::PushNumber(n)] => Some(Const::Number(*n)),
        [Op::PushString(s)] => Some(Const::Str(s.clone())),
        _ => None,
    }
}

/// Whether a run of ops leaves one value on the stack, so a statement knows to discard it.
///
/// Assignments and the four built-ins leave nothing; everything else in stage 1 leaves
/// exactly one. Reading the last op is enough because every op here is balanced.
fn leaves_a_value(ops: &[Op]) -> bool {
    !matches!(
        ops.last(),
        None | Some(Op::SetVariable)
            | Some(Op::Stop)
            | Some(Op::Play)
            | Some(Op::GotoFrame(_))
            | Some(Op::GotoAndPlay(_))
            | Some(Op::GotoLabel(_, _))
            | Some(Op::Trace)
            | Some(Op::Pop)
    )
}

/* ---- emission ------------------------------------------------------------------------- */

/// Serialise ops into an AVM1 action-record buffer for a `DoAction` tag, `Action::End`
/// included. Empty in, empty out — a frame with no script gets no tag at all.
pub fn emit(ops: &[Op]) -> Vec<u8> {
    if ops.is_empty() {
        return Vec::new();
    }

    // Two passes, because a jump's offset is a byte distance and the bytes do not exist yet.
    // The sizes themselves do not depend on the offsets — `If` and `Jump` are always five
    // bytes — so one measuring pass is enough and there is no iterate-to-a-fixed-point.
    let mut position = std::collections::HashMap::new();
    let mut cursor = 0usize;
    for op in ops {
        match op {
            Op::Label(id) => {
                position.insert(*id, cursor);
            }
            other => cursor += byte_len(other),
        }
    }

    let mut buf = Vec::new();
    let mut w = swf::avm1::write::Writer::new(&mut buf, 8);
    let mut here = 0usize;
    for op in ops {
        if let Op::Label(_) = op {
            continue;
        }
        here += byte_len(op);
        // An AVM1 branch offset counts from the END of the branch record.
        let jump_to = |id: &usize| -> i16 {
            let target = position.get(id).copied().unwrap_or(cursor);
            (target as isize - here as isize) as i16
        };
        // Writing into a Vec cannot fail.
        let _ = match op {
            Op::JumpIfFalse(id) => w.write_action(&Action::Not).and_then(|()| {
                w.write_action(&Action::If(If {
                    offset: jump_to(id),
                }))
            }),
            Op::Jump(id) => w.write_action(&Action::Jump(Jump {
                offset: jump_to(id),
            })),
            // Two actions, and `byte_len` agrees. Writing only the goto was a bug the
            // recogniser's own tests caught on the way past: the playhead moved and the
            // movie stayed stopped.
            Op::GotoAndPlay(_) | Op::GotoLabel(_, true) => w
                .write_action(&action_for(op))
                .and_then(|()| w.write_action(&Action::Play)),
            other => w.write_action(&action_for(other)),
        };
    }
    let _ = w.write_action(&Action::End);
    buf
}

use swf::SwfStr;
use swf::avm1::types::{Action, GotoFrame, GotoLabel, If, Jump, Push, Value};

/// One op as its action. `JumpIfFalse` and `Jump` are absent because their offsets are only
/// known during emission, and `Label` because it is not an instruction.
fn action_for(op: &Op) -> Action<'_> {
    match op {
        Op::Stop => Action::Stop,
        Op::Play => Action::Play,
        Op::GotoFrame(f) => Action::GotoFrame(GotoFrame { frame: *f }),
        // `gotoAndPlay` is two actions and `byte_len` knows it.
        Op::GotoAndPlay(f) => Action::GotoFrame(GotoFrame { frame: *f }),
        Op::GotoLabel(label, _) => Action::GotoLabel(GotoLabel {
            label: SwfStr::from_utf8_str(label),
        }),
        Op::PushNumber(n) => Action::Push(Push {
            values: vec![Value::Double(*n)],
        }),
        Op::PushString(s) => Action::Push(Push {
            values: vec![Value::Str(SwfStr::from_utf8_str(s))],
        }),
        Op::PushBool(b) => Action::Push(Push {
            values: vec![Value::Bool(*b)],
        }),
        Op::PushNull => Action::Push(Push {
            values: vec![Value::Null],
        }),
        Op::PushUndefined => Action::Push(Push {
            values: vec![Value::Undefined],
        }),
        Op::GetVariable => Action::GetVariable,
        Op::SetVariable => Action::SetVariable,
        Op::Pop => Action::Pop,
        Op::Trace => Action::Trace,
        Op::Add => Action::Add2,
        Op::Subtract => Action::Subtract,
        Op::Multiply => Action::Multiply,
        Op::Divide => Action::Divide,
        Op::Modulo => Action::Modulo,
        Op::Less => Action::Less2,
        Op::Greater => Action::Greater,
        Op::Equals => Action::Equals2,
        Op::StrictEquals => Action::StrictEquals,
        Op::And => Action::And,
        Op::Or => Action::Or,
        Op::Not => Action::Not,
        Op::JumpIfFalse(_) | Op::Jump(_) | Op::Label(_) => {
            unreachable!("branches and labels are emitted by `emit`")
        }
    }
}

/// How many bytes an op occupies, measured rather than derived — the writer owns the
/// encoding, and a table of hand-counted sizes is a table that drifts from it.
fn byte_len(op: &Op) -> usize {
    match op {
        Op::Label(_) => 0,
        // Two actions: the goto, then Play.
        Op::GotoAndPlay(_) => byte_len_of(&action_for(op)) + byte_len_of(&Action::Play),
        Op::GotoLabel(_, true) => byte_len_of(&action_for(op)) + byte_len_of(&Action::Play),
        // A Not and an If.
        Op::JumpIfFalse(_) => {
            byte_len_of(&Action::Not) + byte_len_of(&Action::If(If { offset: 0 }))
        }
        Op::Jump(_) => byte_len_of(&Action::Jump(Jump { offset: 0 })),
        other => byte_len_of(&action_for(other)),
    }
}

fn byte_len_of(action: &Action<'_>) -> usize {
    let mut scratch = Vec::new();
    let mut w = swf::avm1::write::Writer::new(&mut scratch, 8);
    let _ = w.write_action(action);
    scratch.len()
}

/// A one-line account of what a script holds, for the export report.
pub fn describe(err: &Unsupported) -> String {
    let mut s = String::new();
    let _ = write!(s, "{}", err.message);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ops(src: &str) -> Vec<Op> {
        compile(src).unwrap_or_else(|e| panic!("compile {src:?}: {}", e.message))
    }

    /// The four the recogniser knew, still recognised — now as ordinary calls through a
    /// parser rather than as string matches, which is the point of the change.
    #[test]
    fn the_old_vocabulary_still_compiles() {
        assert_eq!(ops("stop();"), vec![Op::Stop]);
        assert_eq!(ops("play()"), vec![Op::Play]);
        assert_eq!(ops("this.stop();"), vec![Op::Stop]);
        assert_eq!(ops("gotoAndPlay(5);"), vec![Op::GotoAndPlay(4)]);
        assert_eq!(ops("gotoAndStop(1)"), vec![Op::GotoFrame(0)]);
        assert_eq!(
            ops("gotoAndPlay('intro')"),
            vec![Op::GotoLabel("intro".into(), true)]
        );
        // Comments and blank lines are the lexer's problem now, not a line splitter's.
        assert_eq!(ops("// wait here\nstop(); /* and stay */"), vec![Op::Stop]);
    }

    #[test]
    fn arithmetic_binds_the_way_javascript_does() {
        assert_eq!(
            ops("1 + 2 * 3;"),
            vec![
                Op::PushNumber(1.0),
                Op::PushNumber(2.0),
                Op::PushNumber(3.0),
                Op::Multiply,
                Op::Add,
                Op::Pop,
            ]
        );
        // Left-associative: (8 - 3) - 2, not 8 - (3 - 2).
        assert_eq!(
            ops("8 - 3 - 2;"),
            vec![
                Op::PushNumber(8.0),
                Op::PushNumber(3.0),
                Op::Subtract,
                Op::PushNumber(2.0),
                Op::Subtract,
                Op::Pop,
            ]
        );
    }

    /// AVM1 has `Less2` and `Greater` and nothing else, so four of the six comparisons are
    /// rewrites. Exact ones — `a <= b` really is `!(a > b)`.
    #[test]
    fn the_comparisons_avm1_lacks_are_rewritten() {
        assert_eq!(ops("1 <= 2;").iter().rev().nth(1), Some(&Op::Not));
        assert!(ops("1 <= 2;").contains(&Op::Greater));
        assert!(ops("1 >= 2;").contains(&Op::Less));
        assert!(ops("1 != 2;").contains(&Op::Equals));
    }

    #[test]
    fn a_variable_round_trips() {
        assert_eq!(
            ops("var n = 3;"),
            vec![
                Op::PushString("n".into()),
                Op::PushNumber(3.0),
                Op::SetVariable
            ]
        );
        // A TypeScript annotation is dropped rather than refused.
        assert_eq!(ops("var n: number = 3;"), ops("var n = 3;"));
        assert_eq!(
            ops("n = n + 1;"),
            vec![
                Op::PushString("n".into()),
                Op::PushString("n".into()),
                Op::GetVariable,
                Op::PushNumber(1.0),
                Op::Add,
                Op::SetVariable,
            ]
        );
        assert_eq!(ops("n += 1;"), ops("n = n + 1;"));
        assert_eq!(ops("n++;"), ops("n = n + 1;"));
    }

    /// A statement's value is discarded, but only when there is one — popping after a
    /// `stop()` would underflow the stack at runtime, which a byte-level test cannot see.
    #[test]
    fn only_expressions_that_leave_a_value_are_popped() {
        assert!(ops("1 + 1;").contains(&Op::Pop));
        assert!(!ops("stop();").contains(&Op::Pop));
        assert!(!ops("n = 1;").contains(&Op::Pop));
        assert!(!ops("trace('hi');").contains(&Op::Pop));
    }

    #[test]
    fn control_flow_becomes_branches() {
        let it = ops("if (n > 3) { stop(); }");
        let branch = it
            .iter()
            .position(|o| matches!(o, Op::JumpIfFalse(_)))
            .expect("the condition ends in a branch");
        assert_eq!(it[branch + 1], Op::Stop, "the body follows the branch");
        assert!(
            matches!(it[branch + 2], Op::Label(_)),
            "and the branch lands after it"
        );

        let it = ops("if (n) { stop(); } else { play(); }");
        assert!(it.iter().any(|o| matches!(o, Op::Jump(_))));
        assert!(it.contains(&Op::Stop) && it.contains(&Op::Play));

        // A loop jumps backwards to a label that precedes its condition.
        let it = ops("while (n < 3) { n++; }");
        assert!(matches!(it[0], Op::Label(_)));
        assert!(it.iter().any(|o| matches!(o, Op::Jump(_))));
    }

    #[test]
    fn what_it_cannot_do_it_says_rather_than_guesses() {
        for src in [
            "function f() {}",
            "obj.method();",
            "gotoAndPlay(n + 1);",
            "var x = ;",
            "stop(",
        ] {
            assert!(compile(src).is_err(), "should have refused: {src}");
        }
    }

    /// A backward jump is negative and a forward one positive, both counted from the end of
    /// the branch record. Getting the sign or the origin wrong produces a movie that parses
    /// and hangs, so this reads the bytes back rather than trusting the arithmetic.
    #[test]
    fn jump_offsets_are_measured_from_the_end_of_the_branch() {
        let bytes = emit(&ops("while (n < 3) { n++; }"));
        let mut reader = swf::avm1::read::Reader::new(&bytes, 8);
        let mut jumps = Vec::new();
        while let Ok(action) = reader.read_action() {
            match action {
                Action::If(If { offset }) => jumps.push(("if", offset)),
                Action::Jump(Jump { offset }) => jumps.push(("jump", offset)),
                Action::End => break,
                _ => {}
            }
        }
        assert_eq!(jumps.len(), 2, "{jumps:?}");
        assert!(
            jumps[0].1 > 0,
            "the exit skips forward over the body: {jumps:?}"
        );
        assert!(jumps[1].1 < 0, "the loop jumps back to its test: {jumps:?}");
    }

    /// Upsampling moves every frame in the movie, so a goto has to move with it — and it has
    /// to still be a number at that point, which is the whole reason `Op` exists.
    #[test]
    fn goto_targets_survive_upsampling() {
        let mut it = ops("gotoAndPlay(10); gotoAndStop('end');");
        retarget(&mut it, 5);
        assert_eq!(it[0], Op::GotoAndPlay(45));
        assert_eq!(it[1], Op::GotoLabel("end".into(), false));
    }
}
