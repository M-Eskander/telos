# Third-party notices

## ONLYOFFICE Docs

This deployment runs the unmodified upstream `onlyoffice/documentserver:9.4.0.1`
image as a separate service. The Telos application code is not a modified
version of ONLYOFFICE; it talks to the Document Server over HTTP. No ONLYOFFICE
source code was changed.

Copyright (C) 2009-2026 Ascensio System SIA.

ONLYOFFICE Docs is licensed under the GNU Affero General Public License v3.0
(AGPLv3), as supplemented by the Additional Terms below. The Additional Terms
form an integral part of the licence and must be included in all copies and
distributions of the Program. The full licence, including these terms, is
included in the image at `/var/www/onlyoffice/documentserver/LICENSE.txt`.

Source and licence:

- Source: <https://github.com/ONLYOFFICE/DocumentServer/tree/v9.4.0>
- Licence: <https://github.com/ONLYOFFICE/DocumentServer/blob/v9.4.0/LICENSE>
- Company: <https://www.onlyoffice.com>

### Additional Terms

> Pursuant to Section 7 of the License, the following terms supplement and
> clarify the application of these conditions. Failure to comply with these
> terms constitutes a violation of the License and may result in termination
> of rights under Section 8 of the License.
>
> **1. Retention of Notices and Attribution.**
>
> Pursuant to Sections 4, 5, and 7(b) of the License, you must retain all
> applicable copyright notices, license notices, warranty disclaimers, and
> attribution or origin notices included in the Program.
>
> **2. Modification Notice Requirement.**
>
> Modified versions of the Program must carry prominent notices stating that
> they have been modified, including the date (or dates) of such modification,
> and must clearly indicate that they are based on the original ONLYOFFICE
> software developed by Ascensio System SIA.
>
> **3. Appropriate Legal Notices in User Interfaces.**
>
> Where the Program, or any modified version thereof, includes interactive
> user interfaces, the required notices shall be displayed through a clearly
> accessible and prominently visible user interface feature, in accordance
> with the requirement to present Appropriate Legal Notices under Section 5
> of the License. Such notices must enable users to:
>
> - (i) identify ONLYOFFICE as the original developer;
> - (ii) understand that the version in use may be a modified version; and
> - (iii) access the applicable license information.
>
> **4. No Trademark License.**
>
> In accordance with Section 7(e) this License does not grant any rights to
> use the trademarks, service marks, trade names, logos, or branding of the
> Licensor. Any use of such trademarks is governed by the Licensor's
> Trademark Policy, available at:
> <https://www.onlyoffice.com/trademark-policy>
>
> **5. Non-Code Content Licensing.**
>
> Certain non-code elements included in the Program or its distribution,
> including but not limited to illustrations, icon sets, and technical writing
> or documentation content, are licensed under the Creative Commons
> Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0). For the
> avoidance of doubt, this license applies solely to such non-code content
> and does not modify or replace the licensing terms applicable to the
> Program's source code, which remains subject to the GNU Affero General
> Public License v3.0 (AGPLv3). Nothing in this section limits any
> obligation to retain copyright notices, attribution, origin information, or
> Appropriate Legal Notices under the AGPLv3 and the additional terms
> applicable to the Program. The full license text is available at:
> <https://creativecommons.org/licenses/by-sa/4.0/legalcode>

### Contact

Ascensio System SIA, 20A-6 Ernesta Birznieka-Upisha Street, Riga, LV-1050,
Latvia, European Union. Email: <info@onlyoffice.com>

### How this deployment complies

- The Document Server is the unmodified upstream image; no file in it is
  patched.
- The image keeps the full licence and all upstream notices. The editor page
  also shows a visible attribution and links to the licence, source and
  trademark policy; the editor's own About dialog shows the product notice.
- No ONLYOFFICE logo or other trademark is used in the Telos UI. The
  "ONLYOFFICE Docs" text is a nominative reference.
- The Telos backend and frontend are separate works that communicate with the
  Document Server over HTTP. They do not contain ONLYOFFICE code.
