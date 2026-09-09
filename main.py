from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

try:
    from playwright.sync_api import BrowserContext, Page, TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except ImportError:  # A friendly message is more useful than a long traceback.
    print("Missing dependency. Run:  pip install -r requirements.txt")
    raise SystemExit(2)


DEFAULT_URL = (
    "https://www.myhome.ge/udzravi-qoneba/qiravdeba/bina/tbilisi/saburtalo/"
    "?deal_types=2&real_estate_types=1&cities=1&urbans=47&districts=4"
    "&currency_id=1&CardView=1&page=1&owner_type=physical"
)
ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "apartments.db"
CSV_PATH = ROOT / "apartments.csv"
PROFILE_PATH = ROOT / ".browser-profile"

LISTING_RE = re.compile(r"/udzravi-qoneba/(\d+)(?:/|\?|$)", re.I)
MOBILE_RE = re.compile(r"(?<!\d)(?:(?:\+|00)?995[\s-]?)?(5\d{2})[\s-]?(\d{2})[\s-]?(\d{2})[\s-]?(\d{2})(?!\d)")
AREA_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:m²|m2|მ²)", re.I)
ROOM_RE = re.compile(r"(\d+)\s*(?:ოთახი|ოთახიანი|room(?:s)?|комнат)", re.I)
BEDROOM_RE = re.compile(r"(\d+)\s*(?:საძინებელი|bedroom(?:s)?|спальн)", re.I)
FLOOR_RE = re.compile(r"(\d+)\s*(?:სართული|floor|этаж)\s*/\s*(\d+)", re.I)
PRICE_RE = re.compile(r"(?:[$€₾]\s*[\d,.]+|[\d,.]+\s*(?:₾|GEL|USD|EUR|ლარი|დოლარი))", re.I)
DATE_RE = re.compile(r"(?:\d{1,2}[:.]\d{2}|\d{1,2}\s+(?:იან|თებ|მარ|აპრ|მაი|ივნ|ივლ|აგვ|სექ|ოქტ|ნოე|დეკ|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))", re.I)


@dataclass
class Apartment:
    apartment_id: str
    title: str = ""
    phone: str = ""
    price: str = ""
    rooms: str = ""
    bedrooms: str = ""
    area_m2: str = ""
    floor: str = ""
    total_floors: str = ""
    address: str = ""
    posted: str = ""
    description: str = ""
    url: str = ""
    first_seen: str = ""


CSV_FIELDS = list(Apartment.__dataclass_fields__)


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def first_match(pattern: re.Pattern[str], text: str, group: int = 1) -> str:
    match = pattern.search(text)
    return clean(match.group(group)) if match else ""


def normalize_phone(value: str) -> str:
    match = MOBILE_RE.search(value)
    return "+995" + "".join(match.groups()) if match else ""


def page_url(base_url: str, number: int) -> str:
    parts = urlsplit(base_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["page"] = str(number)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def db_connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS apartments (
            apartment_id TEXT PRIMARY KEY,
            title TEXT, phone TEXT, price TEXT, rooms TEXT, bedrooms TEXT,
            area_m2 TEXT, floor TEXT, total_floors TEXT, address TEXT,
            posted TEXT, description TEXT, url TEXT, first_seen TEXT NOT NULL
        )
        """
    )
    connection.commit()
    return connection


def known_ids(connection: sqlite3.Connection) -> set[str]:
    return {row[0] for row in connection.execute("SELECT apartment_id FROM apartments")}


def save_apartment(connection: sqlite3.Connection, item: Apartment) -> None:
    values = asdict(item)
    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    connection.execute(
        f"INSERT OR REPLACE INTO apartments ({columns}) VALUES ({placeholders})",
        tuple(values.values()),
    )
    connection.commit()


def export_csv(connection: sqlite3.Connection, path: Path) -> None:
    rows = connection.execute(
        f"SELECT {', '.join(CSV_FIELDS)} FROM apartments ORDER BY first_seen DESC"
    ).fetchall()
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(CSV_FIELDS)
        writer.writerows(rows)


def wait_through_challenge(page: Page, timeout_seconds: int = 180) -> None:
    deadline = time.monotonic() + timeout_seconds
    warned = False
    while time.monotonic() < deadline:
        title = clean(page.title()).lower()
        text = clean(page.locator("body").inner_text(timeout=5_000)).lower()
        challenged = (
            "just a moment" in title
            or "checking your browser" in text
            or "verify you are human" in text
            or "enable javascript and cookies" in text
        )
        if not challenged:
            return
        if not warned:
            print("MyHome security check is open. Complete it in the browser window...")
            warned = True
        time.sleep(2)
    raise RuntimeError("The MyHome security check was not completed within 3 minutes.")


def collect_cards(page: Page, url: str) -> list[dict[str, str]]:
    page.goto(url, wait_until="domcontentloaded", timeout=90_000)
    wait_through_challenge(page)
    try:
        page.wait_for_selector('a[href*="/udzravi-qoneba/"]', timeout=30_000)
    except PlaywrightTimeoutError:
        print(f"No listing links found on {url}")
        return []

    raw = page.locator('a[href*="/udzravi-qoneba/"]').evaluate_all(
        """els => els.map(a => ({
            href: a.href,
            text: (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim()
        }))"""
    )
    unique: dict[str, dict[str, str]] = {}
    for candidate in raw:
        match = LISTING_RE.search(candidate.get("href", ""))
        if match and match.group(1) not in unique:
            unique[match.group(1)] = {
                "id": match.group(1),
                "url": candidate["href"].split("#", 1)[0],
                "text": clean(candidate.get("text")),
            }
    return list(unique.values())


def json_ld(page: Page) -> list[Any]:
    result: list[Any] = []
    for value in page.locator('script[type="application/ld+json"]').all_text_contents():
        try:
            result.append(json.loads(value))
        except (json.JSONDecodeError, TypeError):
            continue
    return result


def walk_json(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def extract_phone(page: Page) -> str:
    for href in page.locator('a[href^="tel:"]').evaluate_all("els => els.map(e => e.href)"):
        phone = normalize_phone(href)
        if phone:
            return phone

    reveal_words = re.compile(
        r"(ტელეფონ|ნომრის ნახვა|ნომერი|show phone|show number|phone|показать номер|телефон)", re.I
    )
    candidates = page.get_by_role("button").all()
    candidates += page.get_by_role("link").all()
    for element in candidates:
        try:
            label = clean(element.inner_text(timeout=750))
            if label and reveal_words.search(label) and element.is_visible():
                element.click(timeout=3_000)
                page.wait_for_timeout(1_200)
                break
        except Exception:
            continue

    for href in page.locator('a[href^="tel:"]').evaluate_all("els => els.map(e => e.href)"):
        phone = normalize_phone(href)
        if phone:
            return phone
    # Some implementations replace the button with plain text.
    return normalize_phone(clean(page.locator("body").inner_text()))


def extract_detail(page: Page, card: dict[str, str]) -> Apartment:
    page.goto(card["url"], wait_until="domcontentloaded", timeout=90_000)
    wait_through_challenge(page)
    page.wait_for_timeout(1_000)

    body = clean(page.locator("body").inner_text(timeout=20_000))
    card_text = card.get("text", "")
    combined = f"{card_text} {body}"
    title = ""
    if page.locator("h1").count():
        title = clean(page.locator("h1").first.inner_text())
    if not title:
        title = clean(page.locator('meta[property="og:title"]').get_attribute("content"))

    description = clean(page.locator('meta[property="og:description"]').get_attribute("content"))
    price = first_match(PRICE_RE, card_text, 0) or first_match(PRICE_RE, body, 0)
    address = ""
    for data in json_ld(page):
        for node in walk_json(data):
            offers = node.get("offers")
            if isinstance(offers, dict) and offers.get("price"):
                currency = clean(offers.get("priceCurrency"))
                price = clean(f"{offers['price']} {currency}")
            location = node.get("address")
            if isinstance(location, dict):
                address = clean(", ".join(str(v) for v in location.values() if v))
            if not description and node.get("description"):
                description = clean(node["description"])

    floor_match = FLOOR_RE.search(combined)
    area = first_match(AREA_RE, combined)
    rooms = first_match(ROOM_RE, combined)
    bedrooms = first_match(BEDROOM_RE, combined)
    posted = first_match(DATE_RE, card_text, 0)

    return Apartment(
        apartment_id=card["id"],
        title=title,
        phone=extract_phone(page),
        price=price,
        rooms=rooms,
        bedrooms=bedrooms,
        area_m2=area,
        floor=clean(floor_match.group(1)) if floor_match else "",
        total_floors=clean(floor_match.group(2)) if floor_match else "",
        address=address,
        posted=posted,
        description=description[:2000],
        url=card["url"],
        first_seen=datetime.now().astimezone().isoformat(timespec="seconds"),
    )


def notify(item: Apartment) -> None:
    print(
        f"NEW  ID {item.apartment_id} | {item.price or '?'} | "
        f"{item.rooms or '?'} rooms | {item.area_m2 or '?'} m² | {item.phone or 'no phone found'}"
    )
    print(f"     {item.title}\n     {item.url}")
    if sys.platform == "win32":
        try:
            import winsound

            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        except Exception:
            pass


def scan(context: BrowserContext, connection: sqlite3.Connection, base_url: str, pages: int) -> int:
    listing_page = context.pages[0] if context.pages else context.new_page()
    cards: list[dict[str, str]] = []
    for number in range(1, pages + 1):
        cards.extend(collect_cards(listing_page, page_url(base_url, number)))

    seen = known_ids(connection)
    unseen = [card for card in cards if card["id"] not in seen]
    print(f"Found {len(cards)} listing links; {len(unseen)} are new.")
    if not unseen:
        return 0

    detail_page = context.new_page()
    saved = 0
    try:
        for card in reversed(unseen):  # Print oldest first, newest last.
            try:
                item = extract_detail(detail_page, card)
                save_apartment(connection, item)
                export_csv(connection, CSV_PATH)
                notify(item)
                saved += 1
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                print(f"Could not read ID {card['id']}: {exc}")
    finally:
        detail_page.close()
    return saved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Watch MyHome.ge for new apartment listings.")
    parser.add_argument("--url", default=DEFAULT_URL, help="MyHome search URL to watch")
    parser.add_argument("--interval", type=int, default=120, help="seconds between checks")
    parser.add_argument("--pages", type=int, default=1, help="number of search pages to scan")
    parser.add_argument("--once", action="store_true", help="scan once and exit")
    parser.add_argument("--headless", action="store_true", help="hide browser (only after Cloudflare is trusted)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.interval < 30:
        print("For responsible polling, --interval must be at least 30 seconds.")
        return 2
    if not 1 <= args.pages <= 100:
        print("--pages must be between 1 and 100.")
        return 2

    connection = db_connect(DB_PATH)
    print(f"Saving results to {CSV_PATH}")
    print("Press Ctrl+C to stop. The first scan treats current listings as new.")
    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(PROFILE_PATH),
                headless=args.headless,
                viewport={"width": 1440, "height": 900},
                locale="ka-GE",
            )
            try:
                while True:
                    started = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
                    print(f"\n[{started}] Checking MyHome...")
                    scan(context, connection, args.url, args.pages)
                    if args.once:
                        break
                    print(f"Next check in {args.interval} seconds.")
                    time.sleep(args.interval)
            finally:
                context.close()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        export_csv(connection, CSV_PATH)
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
