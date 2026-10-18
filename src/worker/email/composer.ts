export type ComposeInput = {
  request: {
    title: string;
    trade: string;
    location: string;
    startDate: string;
    crewSize: number;
    description: string;
  };
  providerName: string;
  links: { accept: string; quote: string; decline: string };
  pixelUrl: string;
  replyTo?: string;
  from: string;
};

export type ComposedEmail = { subject: string; from: string; replyTo?: string; text: string; html: string };

function briefBlock(r: ComposeInput["request"]): string {
  return [
    `Title: ${r.title}`,
    `Trade: ${r.trade}`,
    `Location: ${r.location}`,
    `Start: ${r.startDate}`,
    `Crew size: ${r.crewSize} workers`,
  ].join("\n");
}

export function composeOutreachEmail(input: ComposeInput): ComposedEmail {
  const { request: r, providerName, links } = input;
  const subject = `Subcrew request: ${r.title} — ${r.trade} in ${r.location}, from ${r.startDate}`;
  const text = `Hello ${providerName},

A general contractor is looking for ${r.trade} crew:

${briefBlock(r)}

${r.description}

Can your company take this work?

Accept: ${links.accept}
Send a quote: ${links.quote}
Decline: ${links.decline}

Links are personal and single-use; the first click records your answer.

— Subcrew`;

  const html = `<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
<p>Hello ${providerName},</p>
<p>A general contractor is looking for <strong>${r.trade}</strong> crew:</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:2px 10px 2px 0;color:#555">Title</td><td>${r.title}</td></tr>
<tr><td style="padding:2px 10px 2px 0;color:#555">Location</td><td>${r.location}</td></tr>
<tr><td style="padding:2px 10px 2px 0;color:#555">Start</td><td>${r.startDate}</td></tr>
<tr><td style="padding:2px 10px 2px 0;color:#555">Crew size</td><td>${r.crewSize} workers</td></tr>
</table>
<p style="font-size:14px">${r.description}</p>
<p>Can your company take this work?</p>
<p>
<a href="${links.accept}" style="display:inline-block;background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;margin-right:8px">Accept</a>
<a href="${links.quote}" style="display:inline-block;background:#059669;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;margin-right:8px">Send a quote</a>
<a href="${links.decline}" style="display:inline-block;background:#e5e7eb;color:#111;padding:8px 14px;border-radius:6px;text-decoration:none">Decline</a>
</p>
<p style="font-size:12px;color:#666">Links are personal and single-use; the first click records your answer.</p>
<img src="${input.pixelUrl}" width="1" height="1" alt="" style="display:none" />
<p>— Subcrew</p>
</body></html>`;

  return { subject, from: input.from, replyTo: input.replyTo, text, html };
}
