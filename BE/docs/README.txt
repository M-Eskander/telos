================================================================================
                     TELOS BACKEND SYSTEM DOCUMENTATION
                          Version 1.0 - June 2026
================================================================================

TABLE OF CONTENTS
================================================================================
1. System Overview
2. Architecture & Design
3. Implementation Details
4. Database Schema
5. API Endpoints
6. Authentication & Authorization
7. Project Structure
8. Key Components
9. Configuration & Setup
10. Testing
11. Development Guide

================================================================================
1. SYSTEM OVERVIEW
================================================================================

PROJECT NAME: Telos Backend
PURPOSE: A project and task management platform with advanced permission and 
access control system.

KEY FEATURES:
- User registration and authentication (email/password)
- Project creation and management
- Task assignment and tracking
- Fine-grained access control using hybrid RBAC (Role-Based Access Control) 
  combined with ABAC (Attribute-Based Access Control)
- Redis-based permission caching for high performance
- Multi-database support (SQLite for dev, MySQL/PostgreSQL for production)

TECHNOLOGY STACK:
- Runtime: Node.js
- Web Framework: Express.js 5.2.1
- Database: SQLite (dev), MySQL/PostgreSQL (prod) via Knex.js 3.2.8
- Authentication: Passport.js with LocalStrategy
- Session Management: express-session with Redis store (connect-redis)
- Caching: Redis 5.12.1
  * User permissions cache (per-user TTL)
  * Session store (persistent across restarts)
- Password Hashing: bcryptjs 3.0.3
- Testing: Jest 30.3.0 + Supertest 7.2.2
- Development: Nodemon 3.0.1, dotenv 17.4.0

For full documentation see: docs/architecture/SYSTEM_ARCHITECTURE.txt

For quick start guides see: docs/guides/

For recent updates see: docs/updates/

================================================================================
QUICK NAVIGATION
================================================================================

Getting Started:
  • docs/guides/QUICK_START_REDIS_SESSIONS.txt
  • docs/guides/.env.example (Configuration template)

Architecture & Design:
  • docs/architecture/SYSTEM_ARCHITECTURE.txt (Full system documentation)
  • docs/architecture/BEFORE_AFTER_COMPARISON.txt (Code changes explained)

Session Management:
  • docs/updates/REDIS_SESSIONS_IMPLEMENTATION.txt
  • docs/updates/SESSION_UPGRADE_COMPLETE.txt

Development:
  • docs/guides/DEVELOPMENT_GUIDE.txt

Updates & Changes:
  • docs/updates/CHANGELOG.txt
  • docs/updates/IMPLEMENTATION_CHECKLIST.txt

================================================================================
