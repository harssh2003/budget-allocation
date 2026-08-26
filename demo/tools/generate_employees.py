#!/usr/bin/env python3
"""
generate_employees.py

Deterministically generates a synthetic 300-employee dataset for a
budget-management demo (100 USA / 100 India / 100 Mexico).

- Python standard library only (no external dependencies).
- Fixed random seed -> identical output on every run.
- Validates the generated dataset before writing any files.
- Fails loudly (non-zero exit, error list on stderr) if validation fails.

Outputs (written to the project root):
    employees.json          portable artefact for review
    employees.csv           spreadsheet-friendly view
    src/data/employees.js   ES module imported by the app and the test suite
"""

import csv
import json
import random
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SEED = 42

OUTPUT_DIR = Path(__file__).resolve().parent.parent  # project root, not tools/
OUTPUT_JSON = OUTPUT_DIR / "employees.json"
OUTPUT_CSV = OUTPUT_DIR / "employees.csv"
OUTPUT_JS = OUTPUT_DIR / "src" / "data" / "employees.js"

COUNTRIES = ["USA", "India", "Mexico"]
COUNT_PER_COUNTRY = 100
TOTAL_RECORDS = COUNT_PER_COUNTRY * len(COUNTRIES)

CURRENCY_BY_COUNTRY = {"USA": "USD", "India": "INR", "Mexico": "MXN"}

# Employee_ID numeric ranges per country (inclusive), per the spec:
# EMP-001..EMP-100 -> USA, EMP-101..EMP-200 -> India, EMP-201..EMP-300 -> Mexico
ID_RANGES = {
    "USA": (1, 100),
    "India": (101, 200),
    "Mexico": (201, 300),
}

REQUIRED_FIELDS = ["Name", "Employee_ID", "Role", "Country", "Salary"]
ALL_FIELDS = REQUIRED_FIELDS + ["Currency"]

# ---------------------------------------------------------------------------
# Name pools (40 first + 40 last names per country -> 1,600 combinations,
# far more than the 100 unique names needed per country)
# ---------------------------------------------------------------------------

FIRST_NAMES = {
    "USA": [
        "James", "Michael", "Robert", "John", "David", "William", "Richard", "Joseph", "Thomas", "Christopher",
        "Daniel", "Matthew", "Anthony", "Mark", "Steven", "Andrew", "Kevin", "Brian", "Jason", "Justin",
        "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
        "Nancy", "Lisa", "Margaret", "Sandra", "Ashley", "Emily", "Amanda", "Michelle", "Kimberly", "Melissa",
    ],
    "India": [
        "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
        "Rohan", "Karthik", "Rahul", "Amit", "Suresh", "Ramesh", "Vijay", "Anil", "Sanjay", "Manoj",
        "Priya", "Ananya", "Diya", "Saanvi", "Aadhya", "Ishita", "Kavya", "Riya", "Neha", "Pooja",
        "Sneha", "Anjali", "Divya", "Meera", "Shruti", "Nisha", "Kiran", "Deepa", "Lakshmi", "Swati",
    ],
    "Mexico": [
        "Jose", "Juan", "Carlos", "Luis", "Miguel", "Jorge", "Francisco", "Alejandro", "Ricardo", "Fernando",
        "Roberto", "Eduardo", "Diego", "Sergio", "Pablo", "Manuel", "Andres", "Gabriel", "Rafael", "Antonio",
        "Maria", "Guadalupe", "Rosa", "Laura", "Patricia", "Sofia", "Fernanda", "Alejandra", "Gabriela", "Adriana",
        "Claudia", "Monica", "Veronica", "Daniela", "Paola", "Carmen", "Leticia", "Silvia", "Martha", "Elena",
    ],
}

LAST_NAMES = {
    "USA": [
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
        "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
        "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
        "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    ],
    "India": [
        "Sharma", "Verma", "Gupta", "Kumar", "Singh", "Patel", "Reddy", "Rao", "Nair", "Iyer",
        "Menon", "Pillai", "Chatterjee", "Banerjee", "Mukherjee", "Das", "Bose", "Chauhan", "Malhotra", "Kapoor",
        "Joshi", "Desai", "Shah", "Mehta", "Agarwal", "Bhatt", "Trivedi", "Naidu", "Krishnan", "Subramanian",
        "Rathore", "Yadav", "Mishra", "Tiwari", "Pandey", "Saxena", "Bhatia", "Chawla", "Arora", "Khanna",
    ],
    "Mexico": [
        "Hernandez", "Garcia", "Martinez", "Lopez", "Gonzalez", "Rodriguez", "Perez", "Sanchez", "Ramirez", "Cruz",
        "Flores", "Gomez", "Diaz", "Reyes", "Morales", "Jimenez", "Alvarez", "Ruiz", "Ortiz", "Chavez",
        "Ramos", "Mendoza", "Vazquez", "Castillo", "Torres", "Gutierrez", "Vargas", "Rojas", "Guerrero", "Medina",
        "Aguilar", "Marin", "Salazar", "Delgado", "Herrera", "Rios", "Nunez", "Cabrera", "Contreras", "Silva",
    ],
}

# Full "First Last" combinations that must never be generated, even by pure
# chance. First and last names are drawn independently, and a handful of
# combinations reachable from the pools above happen to coincide with real
# public figures or well-known fictional characters (e.g. "Michael" + "Scott"
# -> The Office; "Amit" + "Shah" -> a sitting government minister). Blocking
# them here keeps the dataset free of that even after reseeding or edits.
DENYLISTED_NAMES = {
    # USA
    "Michael Scott", "Robert Smith", "Justin Thomas", "Karen Smith",
    "Elizabeth Taylor", "Michael Jackson", "James Brown", "John Williams",
    "Brian Williams", "Andrew Jackson", "Karen Allen", "Robert Lee",
    "Jason Williams", "Christopher Martin", "Michael Moore", "Richard Wright",
    "Richard Harris", "Brian Jones", "Brian Thompson",
    # India
    "Amit Shah", "Sanjay Gupta", "Anil Kapoor", "Arjun Kapoor", "Kiran Rao",
    # Mexico
    "Jorge Ramos", "Carlos Chavez",
}

# ---------------------------------------------------------------------------
# Roles and their relative frequency weights.
# Weighted heavily toward individual-contributor roles so the population
# looks like a real org (many ICs, fewer managers).
# ---------------------------------------------------------------------------

ROLE_WEIGHTS = [
    ("Software Engineer", 22),
    ("Senior Software Engineer", 15),
    ("Data Analyst", 10),
    ("Data Scientist", 8),
    ("ML Engineer", 7),
    ("DevOps Engineer", 8),
    ("Product Manager", 8),
    ("Senior Product Manager", 4),
    ("Engineering Manager", 5),
    ("Sales Manager", 5),
    ("HR Manager", 4),
    ("Financial Analyst", 8),
]
ROLES = [role for role, _weight in ROLE_WEIGHTS]
ROLE_SET = set(ROLES)
WEIGHTS = [weight for _role, weight in ROLE_WEIGHTS]

# ---------------------------------------------------------------------------
# Salary bands: country -> role -> (low, high) in local currency, annual.
# Bands intentionally differ a lot by country (different currencies/scales)
# and by role (seniority/skill premium), so salaries vary meaningfully both
# within a role and across roles/countries.
# ---------------------------------------------------------------------------

SALARY_BANDS = {
    "USA": {
        "Software Engineer": (70_000, 145_000),
        "Senior Software Engineer": (110_000, 190_000),
        "Data Analyst": (55_000, 95_000),
        "Data Scientist": (95_000, 165_000),
        "ML Engineer": (110_000, 200_000),
        "DevOps Engineer": (90_000, 160_000),
        "Product Manager": (100_000, 170_000),
        "Senior Product Manager": (140_000, 210_000),
        "Engineering Manager": (150_000, 240_000),
        "Sales Manager": (80_000, 150_000),
        "HR Manager": (75_000, 130_000),
        "Financial Analyst": (60_000, 110_000),
    },
    "India": {
        "Software Engineer": (600_000, 1_600_000),
        "Senior Software Engineer": (1_400_000, 2_800_000),
        "Data Analyst": (500_000, 1_100_000),
        "Data Scientist": (1_200_000, 2_600_000),
        "ML Engineer": (1_400_000, 3_200_000),
        "DevOps Engineer": (1_000_000, 2_400_000),
        "Product Manager": (1_500_000, 3_000_000),
        "Senior Product Manager": (2_500_000, 4_200_000),
        "Engineering Manager": (3_000_000, 5_000_000),
        "Sales Manager": (900_000, 2_000_000),
        "HR Manager": (800_000, 1_800_000),
        "Financial Analyst": (700_000, 1_500_000),
    },
    "Mexico": {
        "Software Engineer": (220_000, 550_000),
        "Senior Software Engineer": (450_000, 850_000),
        "Data Analyst": (200_000, 420_000),
        "Data Scientist": (400_000, 800_000),
        "ML Engineer": (450_000, 900_000),
        "DevOps Engineer": (380_000, 780_000),
        "Product Manager": (480_000, 900_000),
        "Senior Product Manager": (750_000, 1_200_000),
        "Engineering Manager": (900_000, 1_500_000),
        "Sales Manager": (350_000, 750_000),
        "HR Manager": (300_000, 650_000),
        "Financial Analyst": (250_000, 550_000),
    },
}

# Round generated salaries to a "clean" increment typical of each currency.
ROUND_TO = {"USA": 500, "India": 10_000, "Mexico": 5_000}

# Skew the within-band distribution toward the lower-middle of the range,
# which is more realistic than a flat/uniform spread (most staff cluster
# below the top of their band; fewer people sit at the very top).
MODE_FRACTION = 0.35


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def make_name_generator(rng, country):
    """Returns a function that yields unique 'First Last' names for a country."""
    firsts = FIRST_NAMES[country]
    lasts = LAST_NAMES[country]
    used = set()

    def generate():
        for _ in range(500):  # generous bound; pool is 1,600 combinations
            candidate = f"{rng.choice(firsts)} {rng.choice(lasts)}"
            if candidate in used or candidate in DENYLISTED_NAMES:
                continue
            used.add(candidate)
            return candidate
        raise RuntimeError(f"Exhausted attempts generating a unique name for {country}")

    return generate


def generate_salary(rng, country, role):
    low, high = SALARY_BANDS[country][role]
    mode = low + (high - low) * MODE_FRACTION
    raw = rng.triangular(low, high, mode)
    step = ROUND_TO[country]
    salary = int(round(raw / step) * step)
    return max(salary, step)  # guarantee strictly positive


def generate_dataset(seed=SEED):
    rng = random.Random(seed)
    records = []

    for country in COUNTRIES:
        next_name = make_name_generator(rng, country)
        start_id, end_id = ID_RANGES[country]
        for emp_num in range(start_id, end_id + 1):
            role = rng.choices(ROLES, weights=WEIGHTS, k=1)[0]
            name = next_name()
            salary = generate_salary(rng, country, role)
            records.append(
                {
                    "Name": name,
                    "Employee_ID": f"EMP-{emp_num:03d}",
                    "Role": role,
                    "Country": country,
                    "Salary": salary,
                    "Currency": CURRENCY_BY_COUNTRY[country],
                }
            )

    return records


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

EMP_ID_RE = re.compile(r"^EMP-(\d{3})$")


def validate(records):
    errors = []

    # 1. Exactly 300 records exist.
    if len(records) != TOTAL_RECORDS:
        errors.append(f"Expected {TOTAL_RECORDS} records, found {len(records)}")

    counts = {country: 0 for country in COUNTRIES}
    ids_seen = set()

    for idx, rec in enumerate(records):
        # 6 & 9. Every required field exists / none omitted.
        if set(rec.keys()) != set(ALL_FIELDS):
            errors.append(
                f"Record {idx} ({rec.get('Employee_ID', '?')}): "
                f"field set {sorted(rec.keys())} != expected {sorted(ALL_FIELDS)}"
            )
        for field in REQUIRED_FIELDS:
            if rec.get(field) in (None, ""):
                errors.append(f"Record {idx} ({rec.get('Employee_ID', '?')}): field '{field}' is missing/empty")

        # 8. Country values are valid.
        country = rec.get("Country")
        if country not in COUNTRIES:
            errors.append(f"Record {idx}: invalid Country '{country}'")
        else:
            counts[country] += 1
            if rec.get("Currency") != CURRENCY_BY_COUNTRY[country]:
                errors.append(f"Record {idx}: Currency '{rec.get('Currency')}' does not match Country '{country}'")

        # Role sanity check.
        if rec.get("Role") not in ROLE_SET:
            errors.append(f"Record {idx}: unrecognized Role '{rec.get('Role')}'")

        # Name must not be a denylisted real/fictional-person collision.
        if rec.get("Name") in DENYLISTED_NAMES:
            errors.append(f"Record {idx}: Name '{rec.get('Name')}' is denylisted")

        # 5 & 10. Employee_ID unique and in the expected range/format.
        emp_id = rec.get("Employee_ID", "")
        match = EMP_ID_RE.match(emp_id)
        if not match:
            errors.append(f"Record {idx}: Employee_ID '{emp_id}' does not match 'EMP-###' format")
        else:
            if emp_id in ids_seen:
                errors.append(f"Duplicate Employee_ID: {emp_id}")
            ids_seen.add(emp_id)

            num = int(match.group(1))
            if country in ID_RANGES:
                lo, hi = ID_RANGES[country]
                if not (lo <= num <= hi):
                    errors.append(f"Employee_ID {emp_id} is out of the expected range {lo}-{hi} for {country}")

        # 7. Every salary is positive.
        salary = rec.get("Salary")
        if not isinstance(salary, int) or salary <= 0:
            errors.append(f"Record {idx} ({emp_id}): Salary '{salary}' is not a positive integer")

    # 2, 3, 4. Per-country counts.
    for country in COUNTRIES:
        if counts[country] != COUNT_PER_COUNTRY:
            errors.append(f"Country '{country}' has {counts[country]} records, expected {COUNT_PER_COUNTRY}")

    # 5. Global uniqueness count.
    if len(ids_seen) != TOTAL_RECORDS:
        errors.append(f"Expected {TOTAL_RECORDS} unique Employee_IDs, found {len(ids_seen)}")

    return errors


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_json(records, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        f.write("\n")


def write_js(records, path):
    """Emit the dataset as an ES module.

    The JSON file is the portable artefact; this module is what the browser and
    the Node test suite import, so neither needs a fetch or a file read. All
    three outputs come from this one generator, so they cannot drift apart.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(records, indent=2, ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/generate_employees.py -- do not edit by hand.\n")
        f.write(f"// {len(records)} records, seed {SEED}. Regenerate with: python3 tools/generate_employees.py\n\n")
        f.write("export const EMPLOYEES = ")
        f.write(body)
        f.write(";\n")


def write_csv(records, path):
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=ALL_FIELDS)
        writer.writeheader()
        writer.writerows(records)


def main():
    records = generate_dataset()
    errors = validate(records)

    if errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    write_json(records, OUTPUT_JSON)
    write_csv(records, OUTPUT_CSV)
    write_js(records, OUTPUT_JS)

    counts = {country: 0 for country in COUNTRIES}
    for rec in records:
        counts[rec["Country"]] += 1

    print(f"Total records: {len(records)}")
    for country in COUNTRIES:
        print(f"{country}: {counts[country]}")
    print(f"Unique Employee IDs: {len({rec['Employee_ID'] for rec in records})}")
    print("Validation: PASSED")


if __name__ == "__main__":
    main()
