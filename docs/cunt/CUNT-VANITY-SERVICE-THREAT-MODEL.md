# Vanity Wallet Service — Threat Model (§22, §23)

**Status: NOT BUILT. RECOMMENDED NOT TO BUILD AS DESCRIBED.**

§23: *"Do not release the service until the threat model is resolved."* This
document resolves it, and the resolution is not the one the idea assumes.

---

## 1. The finding

The proposal (§22) is that users pay for **computational work** to generate a
Solana wallet ending in `CUNT` — `Alice…CUNT`, `X…CUNT`.

§23 hopes for a design where *"the user creates secret entropy that the server
never knows"*. There is a well-known cryptographic construction that does
exactly this, and it is what makes paid vanity generation defensible on
Bitcoin.

> **It does not work on Solana.**

That is the central finding, and everything below follows from it.

### Why it works on Bitcoin

Split-key vanity generation, on secp256k1:

1. User generates private scalar `a`, sends only public point `A = a·G`.
2. Service grinds an offset scalar `b` until `A + b·G` encodes to the pattern.
3. Service sends **`b`** — a useless value on its own.
4. User computes the final private key `a + b`.

The service never learns `a`, so it never learns `a + b`. It sells real compute
and **cannot** steal the result. Elegant, and genuinely safe.

### Why it does not work on Solana

Ed25519 keys are not scalars. Verified against this repo's own dependencies:

```
Solana secretKey     = 64 bytes = 32-byte SEED + 32-byte pubkey
public key           = derived from the seed alone
signing scalar       = clamped SHA-512(seed)      ← one-way
```

The private half a wallet can **import** is the **seed**. The scalar used for
signing is a *hash* of it.

So the arithmetic still works — `A + b·G` is a perfectly good point, and you
could compute the combined scalar `a + b`. But **no seed produces that scalar**,
because finding one means inverting SHA-512. The user would be handed a key that
Phantom, Solflare and the Solana CLI cannot import, because every one of them
expects a seed.

To be precise rather than absolute: signing with a raw "expanded" scalar is
cryptographically possible and some libraries support it. It is not *impossible*
— it is **unusable as a consumer product**, since the customer receives an
address only bespoke software can operate. For a wallet people are meant to
hold funds in, that is disqualifying.

### What that leaves

**If we perform the computation, we hold the key.** There is no cryptographic
escape on Ed25519. That is not an implementation detail to engineer around; it
is the shape of the problem.

So there are exactly two honest products:

| | Product | Who holds the key |
|---|---|---|
| **A** | We sell **software**; the user grinds on their own machine | Only the user. Ever. |
| **B** | We sell **compute**; we grind and deliver | **Us, at some moment.** Custodial. |

§22 describes **B**. This document recommends **A**.

## 2. Threat table — for option B, if it is built anyway

Every threat §23 names, with the honest assessment. Severity assumes a wallet
that will hold funds.

| Threat | Sev | Reality |
|---|---|---|
| **Operator retains the key** | **CRITICAL** | Not a risk to mitigate — an *inherent property*. We generated it; we had it. Every other row is downstream of this. |
| **Database leak** | **CRITICAL** | Any store of delivered keys is a bearer-asset database. It will be targeted precisely because it is enumerable and high-value. |
| **Compromised server** | **CRITICAL** | An attacker with server access gets keys *as they are generated*, silently, for as long as they stay. Detection would be after the theft. |
| **Backup retention** | **CRITICAL** | Backups outlive deletion policies. "We delete after delivery" is false if any backup ran. |
| **Log exposure** | HIGH | One `console.log(keypair)` during debugging leaks permanently — logs get shipped, archived and searched. The scanner in this repo exists because that class of mistake is normal. |
| **Support staff access** | HIGH | "I lost my key, can you resend it?" is only answerable if we kept it. Answering it once destroys the security model; refusing it makes the product look broken. |
| **Malware on the grinding host** | HIGH | The grinding machine becomes a high-value target holding many keys over time. |
| **Insecure download** | HIGH | Delivery over anything short of an authenticated, ephemeral channel exposes the key in transit and at rest on the CDN/mail server. Email is disqualifying. |
| **MITM** | MEDIUM | TLS handles the wire, but any relay, proxy or PHP hop that terminates it sees plaintext. Note this project already routes API traffic through a PHP proxy and an ngrok tunnel. |
| **Clipboard theft** | MEDIUM | "Copy your private key" puts it where every clipboard-scraping malware family looks. |
| **Browser persistence** | MEDIUM | Displaying a key in a page risks it landing in cache, history, session restore, extensions, or a screenshot. |

There is no combination of these mitigations that removes row one, and row one
is the product.

## 3. The scale problem

A single leaked key loses one wallet. A leaked *service* loses **every wallet it
ever generated**, including ones sold months earlier whose owners have since
funded them.

That is the asymmetry that makes this different from ordinary key handling: the
blast radius grows with every sale, and stays grown.

## 4. Recommended design — option A

**Ship the tool, not the key.**

1. **Client-side generation only.** A browser WASM grinder, or a signed CLI
   binary. Generation happens on the customer's machine; nothing is transmitted.
2. **We never receive a private key.** Not in a request, not in a log, not in a
   support ticket. There is no endpoint that accepts one.
3. **Open source the grinder.** A closed-source key generator is unauditable,
   which is the exact posture that made Profanity possible.
4. **Build from source, reproducibly** (§39).

### What is actually being sold

A GPU grinder that is fast, correct, audited and easy — plus, if wanted, a
hosted queue that manages *the customer's own* job on hardware they control.

**Honest framing:** it sells software and convenience, not compute-on-your-
behalf. That is a smaller product than §22 imagines, and it is the one that can
be defended in public.

### If option B is chosen regardless

Non-negotiable minimums, none of which fix row one:

- Key material **never touches disk** on the server — memory only, zeroed after
  delivery
- Delivery through a **one-time, authenticated, expiring** channel; never email
- **No database of keys.** Nothing persisted, ever
- Grinding host isolated, no backups, no shared credentials
- Published, testable **key-destruction** procedure
- **Support cannot recover a key** — stated before purchase, not after
- Explicitly disclosed: **we generated it and could have kept a copy**, and the
  customer should treat it as compromised for large balances

That last line is the honest advertisement for option B. If it reads badly,
that is the threat model doing its job.

## 5. Communication guardrails (§52)

Regardless of design:

- It is a **service fee for computational work**, never an investment
- **No ROI language.** Not "pay 0.5 SOL and earn it back in four years", not
  break-even, not yield, not appreciation
- If vanity ownership later becomes a Tuesday eligibility signal, that is a
  **separate protocol mechanic** and must not be sold as a return
- No promise that a vanity address has resale value

## 6. Decision

**Do not build the custodial version.** §23 says not to implement casually; the
finding here is stronger — the construction that would have made it safe is
unavailable on this curve, so "careful custodial" is the only custodial option
and it still means holding customer keys.

Open questions, none of which change the above:

1. Is a client-side grinder still a viable product without the compute service?
2. Would a GPU WASM/binary grinder be fast enough in a browser to be worth
   paying for?
3. Does selling a grinder create liability if a customer's own machine is
   compromised?

Answer 1 before spending effort on 2.
