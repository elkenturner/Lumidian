"""T1/T2/T3 domain authority classification for cluster evidence packs.

T1: established press, major wire services, peer-reviewed, .gov, .edu
T2: trade press, recognized industry publications
T3: everything else (default — long tail, marketing blogs, etc.)

The T1/T2 sets are curated by hand and live in code so they're version-
controlled. Add a domain via PR.
"""
from __future__ import annotations

from typing import Literal

Tier = Literal["T1", "T2", "T3"]

T1_DOMAINS: set[str] = {
    # Wire services & global press
    "nytimes.com", "reuters.com", "bloomberg.com", "wsj.com", "ap.org",
    "ft.com", "economist.com", "washingtonpost.com", "bbc.com", "bbc.co.uk",
    "theguardian.com", "npr.org", "afp.com", "time.com", "newyorker.com",
    "theatlantic.com", "politico.com", "propublica.org", "aljazeera.com", "dw.com",
    # Peer-reviewed / scientific
    "nature.com", "science.org", "thelancet.com", "nejm.org", "pnas.org",
    "cell.com", "jamanetwork.com", "bmj.com", "arxiv.org",
    # Major academic medical centers (treated as primary medical authority)
    "mayoclinic.org", "clevelandclinic.org", "hopkinsmedicine.org",
    "mskcc.org", "dana-farber.org", "stanfordhealthcare.org", "uclahealth.org",
    "mountsinai.org",
    # Top-tier business / policy
    "hbr.org", "mckinsey.com", "brookings.edu", "rand.org", "cfr.org",
    "imf.org", "worldbank.org", "oecd.org", "pewresearch.org", "nber.org",
    "iea.org",
    # Standards bodies
    "w3.org", "ietf.org", "iso.org",
    # Encyclopedic / reference (Wikipedia is a primary citation source for AI
    # models and is broadly accepted as authoritative for general knowledge;
    # britannica is its smaller curated counterpart)
    "wikipedia.org", "britannica.com",
}

T2_DOMAINS: set[str] = {
    # Tech trade press
    "techcrunch.com", "theverge.com", "wired.com", "arstechnica.com",
    "venturebeat.com", "theinformation.com", "404media.co", "engadget.com",
    "protocol.com", "restofworld.org", "theregister.com", "zdnet.com",
    "cnet.com", "techradar.com", "tomshardware.com", "anandtech.com", "phoronix.com",
    # Business trade press
    "forbes.com", "fortune.com", "businessinsider.com", "fastcompany.com",
    "cnbc.com", "axios.com", "marketwatch.com", "barrons.com", "qz.com",
    "pitchbook.com", "crunchbase.com", "inc.com", "entrepreneur.com",
    # SaaS / marketing trade
    "saastr.com", "a16z.com", "stratechery.com", "firstround.com",
    "producthunt.com", "niemanlab.org", "cjr.org", "digiday.com",
    "adage.com", "marketingbrew.com", "morningbrew.com", "puck.news",
    # Sector trade
    "statnews.com", "medscape.com", "endpts.com", "automotivenews.com",
    "electrek.co", "retaildive.com", "glossy.co", "bankingdive.com",
    "american-banker.com", "eweek.com", "infoworld.com", "vcnewsdaily.com",
    "builtin.com", "govtech.com", "edtechmagazine.com", "govdelivery.com",
    "federaltimes.com", "dealnews.com",
}


def _normalize(domain: str) -> str:
    d = (domain or "").strip().lower()
    if d.startswith("www."):
        d = d[4:]
    return d


def classify_domain(domain: str) -> Tier:
    """Classify a bare domain (e.g. 'nytimes.com') into T1/T2/T3."""
    d = _normalize(domain)
    if not d:
        return "T3"
    if d in T1_DOMAINS:
        return "T1"
    if d in T2_DOMAINS:
        return "T2"
    # Heuristics for the long tail
    if d.endswith(".gov") or d.endswith(".gov.uk"):
        return "T1"
    if d.endswith(".edu"):
        return "T1"
    return "T3"
