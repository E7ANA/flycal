"""Import school data from the spreadsheet.

Imports subjects (מקצועות) and meetings (ישיבות).
Excludes: פרטני, שהייה, תפילה, שיחות אישיות, הכנת חומרים.
Uses only the שובץ column (not שעות).
"""

import re
import sys

from app.database import SessionLocal
from app.models.school import School
from app.models.class_group import ClassGroup, Grade, GroupingCluster, Track, cluster_source_classes
from app.models.teacher import Teacher, teacher_subjects
from app.models.subject import Subject, SubjectRequirement
from app.models.meeting import Meeting, MeetingType, meeting_teachers
from app.models.constraint import Constraint, ConstraintType, RuleType

# ── Raw data (tab-separated: classes, subject, teacher, שובץ, שעות) ──────────
RAW_DATA = r"""
ז' 1	חינוך גופני	אדרי מירב	2	2
ז' 1	ארץ ישראל	בן שטרית מוריה	1	1
	אל"ה	הראל חיים קלוד	1	2
ז' 1	היסטוריה	מטלון רבקי	2	2
ז' 1	ספרות	נאמן עדי	1	1
ז' 1	לשון	בן דוד רות	0	3
ז' 1	לשון	קרים מורג	3	3
ז' 1	חינוך	עליאש גולדי	1	1
ז' 1		הראל חיים קלוד	0	1
ז' 1	הלכה	סויסה רויטל	1	1
ז' 1	תנ"ך	עליאש גולדי	5	5
ז' 1	אל"ה	הראל חיים קלוד	0	2
ז' 1	גשרים	אלמליח חדוה	2	2
ז' 2	חינוך	שיוביץ אושרית	1	1
ז' 2	אל"ה	הראל חיים קלוד	0	2
ז' 2	לשון	שיוביץ אושרית	3	3
ז' 2	חינוך גופני	אדרי מירב	2	2
ז' 2	ארץ ישראל	בן שטרית מוריה	1	1
ז' 2	אל"ה	הראל חיים קלוד	2	2
ז' 2	היסטוריה	מטלון רבקי	2	2
ז' 2	ספרות	נאמן עדי	1	1
ז' 2	הלכה	סויסה רויטל	1	1
ז' 2	נביא	אלמליח חדוה	2	2
ז' 2	תורה	שיוביץ אושרית	3	3
ז' 2	גשרים	אלמליח חדוה	2	2
ז' 1	אל"ה	הראל חיים קלוד	1	2
ז' 1	תושב"ע	כהן אלגריה גילה	2	2
ז' 2	תושב"ע	סויסה רויטל	2	2
ז' 2	אל"ה	הראל חיים קלוד	0	2
ז' 1, ז' 2	אנגלית	פרוכטר שירה	4	4
ז' 1, ז' 2	אנגלית	רביבו יוכבד שושנה	4	4
ז' 1, ז' 2	אנגלית	עטיה הודיה	4	4
ז' 1, ז' 2	מתמטיקה	עליאש גולדי	5	5
ז' 1, ז' 2	מתמטיקה	פוקר רחל	5	5
ז' 1, ז' 2	מתמטיקה	בוחבוט צופיה	5	5
ז' 1, ז' 2	אמירים	נאמן חנה אביגיל	1	1
ז' 1, ז' 2	אמירים	הלימי עינב	1	2
ז' 1, ז' 2	מדעים	בוחניק שילת	3	3
ז' 1, ז' 2	מדעים	הלימי עינב	3	3
ז' 1, ז' 2	מדעים	אלמליח חדוה	3	3
ז' 1, ז' 2	התמחויות	נאמן עדי	2	2
ז' 1, ז' 2	נפגשות	קרואני יערית	1	1
ז' 1, ז' 2	נפגשות	נאמן עדי	1	1
ז' 1, ז' 2	נפגשות	קולטון אושרית	1	1
ז' 1, ז' 2	נפגשות	סעד ליאל עיושה	1	1
ז' 2	תכנית אל"ה	הראל חיים קלוד	0	0
ז' 1	תכנית אל"ה	הראל חיים קלוד	0	0
ח' 1	חינוך גופני	אדרי מירב	2	2
ח' 1	חינוך	דמרי זוהר	0	1
ח' 1	היסטוריה	דמרי זוהר	2	2
ח' 1	ספרות	דמרי זוהר	0	1
ח' 1	מדעים	הלימי עינב	0	1
ח' 1	תורה	דמרי זוהר	3	3
ח' 1	לשון	קרים מורג	3	3
ח' 1	חינוך	דמרי זוהר	1	3
ח' 2	נביא	בן דוד רות	2	2
ח' 1	הלכה	סויסה רויטל	1	1
ח' 2	חינוך גופני	אדרי מירב	2	2
ח' 1	ארץ ישראל	בן שטרית מוריה	1	1
ח' 2	היסטוריה	בן שטרית מוריה	1	1
ח' 1	נביא	רוזנפלד כנרת נינה	2	2
ח' 2	ספרות	רוזנפלד כנרת נינה	0	2
ח' 2	תורה	בן שטרית מוריה	3	3
ח' 2	לשון	שיוביץ אושרית	0	3
ח' 2	לשון	קרים מורג	3	3
ח' 2	חינוך	בן שטרית מוריה	0	1
ח' 2	הלכה	סויסה רויטל	1	1
ח' 1	גשרים	אלמליח חדוה	0	2
ח' 2	גשרים	אלמליח חדוה	2	2
ח' 2	חינוך	בן שטרית מוריה	1	1
ח' 1, ח' 2	אנגלית	פרוכטר שירה	4	4
ח' 1, ח' 2	אנגלית	עטיה הודיה	4	4
ח' 1, ח' 2	אנגלית	כהן אחינעם	4	4
ח' 1, ח' 2	נפגשות	נאמן עדי	1	1
ח' 1, ח' 2	נפגשות	קרואני יערית	1	1
ח' 1, ח' 2	נפגשות	קולטון אושרית	1	1
ח' 1, ח' 2	נפגשות	סעד ליאל עיושה	1	1
ח' 1, ח' 2	מתמטיקה	ברט עדינה	5	5
ח' 1, ח' 2	מתמטיקה	ברט עדינה	0	5
ח' 1, ח' 2	מתמטיקה	קדוש סמדר	5	5
ח' 1, ח' 2	מתמטיקה	צור הודיה	1	1
ח' 1, ח' 2	מתמטיקה	סויסה רויטל	4	5
ח' 1, ח' 2	מתמטיקה		0	1
ח' 1, ח' 2	מתמטיקה	בוחבוט צופיה	0	1
ח' 1, ח' 2	מדעים	אלמליח חדוה	3	3
ח' 1, ח' 2	מדעים	בוחניק שילת	3	3
ח' 1, ח' 2	מדעים	הלימי עינב	3	3
ח' 1, ח' 2	מרחב	למברגר אודיה	2	2
ח' 1, ח' 2	מרחב	בן שטרית מוריה	2	2
ח' 1, ח' 2	מרחב	שיוביץ אושרית	2	2
ח' 1, ח' 2	מרחב	הלימי עינב	2	2
ח' 1, ח' 2	אמירים	למברגר אודיה	1	1
ח' 1, ח' 2	אמירים	הלימי עינב	2	2
ח' 1	תושב"ע	כהן אלגריה גילה	2	2
ח' 1	תושב"ע	בן דוד רות	0	2
ח' 2	תושב"ע	בן שטרית מוריה	2	2
ח' 1	כינוס	חדד חוה	1	1
ז' 2	כינוס	שיוביץ אושרית	1	1
ז' 1	כינוס	עליאש גולדי	1	1
ח' 1	כינוס	דמרי זוהר	1	1
ח' 2	כינוס	בן שטרית מוריה	1	1
	כינוס	נאמן עדי	1	1
	כינוס	למברגר אודיה	1	1
	כינוס	סעד ליאל עיושה	1	1
ט' 1	חינוך גופני	אדרי מירב	2	2
ט' 1	היסטוריה	דמרי זוהר	2	3
ט' 1	נביא	רוזנפלד כנרת נינה	2	2
ט' 1	תושב"ע	רוזנפלד כנרת נינה	2	3
ט' 1	לשון	שיוביץ אושרית	3	3
ט' 1	מדעים	הלימי עינב	3	3
ט' 1	חינוך	רוזנפלד כנרת נינה	1	1
ט' 2	חינוך גופני	אדרי מירב	2	2
ט' 2	היסטוריה	כהן אלגריה גילה	2	2
ט' 2	תושב"ע	כהן אלגריה גילה	2	3
ט' 2	לשון	נאמן חנה אביגיל	3	3
ט' 2	מדעים	הלימי עינב	3	3
ט' 2	חינוך	בר כהן תמר	1	1
ט' 2	נביא	בר כהן תמר	2	2
ט' 2	חינוך	בר כהן תמר	0	2
ט' 1, ט' 2	אנגלית ב'	כהן אחינעם	4	4
ט' 1, ט' 2	אנגלית א2	עטיה הודיה	4	4
ט' 1, ט' 2	אנגלית א1	פרוכטר שירה	4	4
ט' 2	ספרות	בר כהן תמר	0	2
ט' 1	ספרות	בר כהן תמר	2	2
ט' 2	התנדבות	רוזנפלד כנרת נינה	2	2
ט' 1	התנדבות	רוזנפלד כנרת נינה	0	2
ט' 1, ט' 2	מתמטיקה א2 יהלום	בוחבוט צופיה	5	5
ט' 1, ט' 2	מתמטיקה א2	פוקר רחל	5	5
ט' 1, ט' 2	מתמטיקה ב'	אסולין חדוה גילה	5	5
ט' 1, ט' 2	מתמטיקה א1	גרוס אדרת תקוה	5	5
ט' 1, ט' 2	סיירת תנ"ך	נאמן חנה אביגיל	3	3
ט' 1	תנ"ך	רוזנפלד כנרת נינה	3	3
ט' 2	תנ"ך	בר כהן תמר	3	3
ט' 1, ט' 2	מרחב	הלימי עינב	2	2
ט' 1, ט' 2	מרחב	מטלון רבקי	2	2
ט' 1, ט' 2	מרחב	פוקר רחל	2	2
ט' 1, ט' 2	מרחב	שיוביץ אושרית	2	2
ט' 1, ט' 2	אמירים	הלימי עינב	2	2
ט' 1, ט' 2	אמירים	למברגר אודיה	0	2
ח' 1, ח' 2, ט' 1, ט' 2	צעיר בספיר	שיוביץ אושרית	1	3
ח' 1, ח' 2, ט' 1, ט' 2	צעיר בספיר	בן שטרית מוריה	1	3
ח' 1, ח' 2, ט' 1, ט' 2	צעיר בספיר	שיוביץ אושרית	3	3
ח' 1, ח' 2, ט' 1, ט' 2	צעיר בספיר	בן שטרית מוריה	3	3
ח' 1, ח' 2, ט' 1, ט' 2	צעיר בספיר	אלמליח חדוה	3	3
י' 1	חינוך גופני	אדרי מירב	2	2
י' 1	מחשבת ישראל	למברגר אודיה	2	2
י' 1	ספרות	סימקוביץ שולמית	2	2
י' 1	לשון	הראל חיים קלוד	3	3
י' 1	חינוך	למברגר אודיה	1	1
י' 2	חינוך גופני	אדרי מירב	2	2
י' 2	מחשבת ישראל	חדד חוה	2	2
י' 2	ספרות	בר כהן תמר	2	2
י' 2	לשון	הראל חיים קלוד	3	3
י' 2	חינוך	אלפה עינב	1	1
י' 2	תנ"ך	אלפה עינב	3	3
י' 1	תנ"ך	למברגר אודיה	3	3
י' 1, י' 2	תורה	סעד ליאל עיושה	2	2
י' 1, י' 2	תורה	למברגר אודיה	2	2
י' 1, י' 2	תורה	אלפה עינב	2	2
י' 1, י' 2	ביולוגיה	לילינטל אריאלה מרים	3	3
י' 1, י' 2	פיזיקה	קליינברג מרדכי	2	2
י' 1, י' 2	ארץ ישראל	פרויליכט הרב ישי	2	2
י' 1, י' 2	קולנוע	נחום אחינעם	2	2
י' 1, י' 2	אנגלית 5 יח	עידן שרה נדיה ז'אן אליס	4	4
י' 1, י' 2	אנגלית 4 יח	עטיה הודיה	4	4
י' 1, י' 2	אנגלית 5 יח	רביבו יוכבד שושנה	4	4
י' 1, י' 2	הייטק	ברט עדינה	2	2
י' 1, י' 2	מתמטיקה 3 יח	פוקר רחל	6	6
י' 1, י' 2	מתמטיקה 5 יח	בוקריס אילנה	6	6
י' 1, י' 2	מתמטיקה 4 יח	בוחבוט צופיה	6	6
י' 1, י' 2	מתמטיקה 4 יח	קדוש סמדר	6	6
י' 1	תושב"ע	קרים מורג	2	2
י' 2	תושב"ע	יפרח יהודה אוהד	2	2
י' 2	היסטוריה	דמרי זוהר	4	4
י' 1	היסטוריה	דמרי זוהר	4	4
י' 2	דמויות מופת	קולטון אושרית	1	1
י' 1	דמויות מופת	סעד ליאל עיושה	1	1
ט' 1	דמויות מופת	קולטון אושרית	1	1
ט' 2	דמויות מופת	סעד ליאל עיושה	1	1
י' 1, י' 2	התנדבות	שיוביץ אושרית	0	2
י' 1, י' 2	התנדבות	קרים מורג	2	2
י' 1, י' 2	התנדבות	אלמליח חדוה	2	2
י' 1, י' 2	מדעי המחשב	כהן יוסף חיים	3	3
יא' 1	חינוך גופני	אדרי מירב	1	1
יא' 1	אזרחות	כהן אלגריה גילה	1	1
יא' 1	לשון	הראל חיים קלוד	4	4
יא' 1	היסטוריה	שטרית אלומה	3	3
יא' 1	חינוך	נאמן חנה אביגיל	1	1
יא' 1	מחשבת ישראל	נאמן חנה אביגיל	0	4
יא' 1, יא' 2	תנ"ך 3 יח	ברט עדינה	4	4
יא' 1	תורה	נאמן חנה אביגיל	3	4
יא' 2	תנ"ך	אלמסי בת אל	6	7
יא' 1	נביא	אלפה עינב	3	3
יא' 2	חינוך גופני	אדרי מירב	1	1
יא' 2	אזרחות	כהן אלגריה גילה	1	1
יא' 2	לשון	הראל חיים קלוד	4	4
יא' 2	היסטוריה	שטרית אלומה	3	3
יא' 2	חינוך	אלמסי בת אל	1	1
יא' 1, יא' 2	תושב"ע	יפרח יהודה אוהד	2	2
יא' 1, יא' 2	תושב"ע	קרים מורג	3	3
יא' 1, יא' 2	מחשבת ישראל	סימקוביץ שולמית	3	3
יא' 1, יא' 2	פיזיקה	קליינברג מרדכי	6	6
יא' 1, יא' 2	ביולוגיה	לילינטל אריאלה מרים	6	6
יא' 1, יא' 2	קולנוע עיוני	נחום אחינעם	3	6
יא' 1, יא' 2	קולנוע מעשי	נחום אחינעם	3	3
יא' 1, יא' 2	אנגלית 4 יח	רביבו יוכבד שושנה	4	4
יא' 1, יא' 2	אנגלית 4 יח	עשוש אביה-מרים	4	4
יא' 1, יא' 2	אנגלית 5 יח	עידן שרה נדיה ז'אן אליס	4	4
יא' 1, יא' 2	מתמטיקה 3 יח	קדוש סמדר	5	5
יא' 1, יא' 2	מתמטיקה 4 יח	עליאש גולדי	6	6
יא' 1, יא' 2	מתמטיקה 5 יח	גרוס אדרת תקוה	6	7
יא' 1, יא' 2	מדעי המחשב	כהן יוסף חיים	2	3
יב' 1	אזרחות	אפרתי לימור	2	4
יב' 2	אזרחות	אפרתי לימור	2	4
יב' 1	חינוך	כהן אלגריה גילה	1	1
יב' 1	בח"מ	כהן אלגריה גילה	2	2
יב' 1, יב' 2	תושב"ע	יפרח יהודה אוהד	2	3
יב' 1	תנ"ך	כהן אלגריה גילה	3	3
יב' 2	נביא	אלמסי בת אל	5	5
יב' 1	נביא	אלמסי בת אל	5	5
יב' 2	חינוך	בוחניק שילת	1	1
יב' 2	בח"מ	בוחניק שילת	2	2
יב' 1, יב' 2	תושב"ע	קרים מורג	2	3
יב' 2	תנ"ך	בוחניק שילת	3	3
יב' 1, יב' 2	אנגלית 4 יח	עטיה הודיה	1	1
יב' 1, יב' 2	אנגלית 4 יח	כהן אחינעם	5	5
יב' 1, יב' 2	אנגלית 5 יח	עידן שרה נדיה ז'אן אליס	5	5
יב' 1, יב' 2	אנגלית 4 יח	עשוש אביה-מרים	4	5
יב' 1, יב' 2	מתמטיקה 3 יח	קדוש סמדר	2	6
יב' 1, יב' 2	מתמטיקה 4 יח	בוקריס אילנה	2	6
יב' 1, יב' 2	מתמטיקה 5 יח	גרוס אדרת תקוה	2	6
יב' 1, יב' 2	פיזיקה	קליינברג מרדכי	6	6
יב' 1, יב' 2	קולנוע עיוני	נחום אחינעם	3	6
יב' 1, יב' 2	ביולוגיה	לילינטל אריאלה מרים	6	6
יב' 1, יב' 2	תיאטרון	אלמגור אפרת	6	6
יב' 1, יב' 2	קולנוע מעשי	נחום אחינעם	3	3
יב' 1, יב' 2	מחשבת ישראל	סימקוביץ שולמית	2	2
יב' 1, יב' 2	מדעי המחשב	כהן יוסף חיים	3	3
יא' 1	כינוס	חדד חוה	1	1
ט' 1	כינוס	רוזנפלד כנרת נינה	1	1
ט' 2	כינוס	בר כהן תמר	1	1
י' 1	כינוס	למברגר אודיה	1	1
י' 2	כינוס	אלפה עינב	1	1
יא' 1	כינוס	נאמן חנה אביגיל	1	1
יא' 2	כינוס	אלמסי בת אל	1	1
	ישיבת מחנכות	נאמן עדי	2	2
	ישיבת מחנכות	עליאש גולדי	2	2
	ישיבת מחנכות	שיוביץ אושרית	2	2
	ישיבת מחנכות	דמרי זוהר	2	2
	ישיבת מחנכות	בן שטרית מוריה	2	2
	ישיבת מחנכות	רוזנפלד כנרת נינה	2	2
	ישיבת מחנכות	בר כהן תמר	2	2
	ישיבת מחנכות	אלפה עינב	2	2
	ישיבת מחנכות	למברגר אודיה	2	2
	ישיבת מחנכות	נאמן חנה אביגיל	2	2
	ישיבת מחנכות	אלמסי בת אל	2	2
	ישיבת מחנכות	כהן אלגריה גילה	2	2
	ישיבת מחנכות	בוחניק שילת	2	2
	ישיבת מחנכות	קרואני יערית	2	2
	ישיבת מחנכות	סעד ליאל עיושה	2	2
	ישיבת מחנכות	קולטון אושרית	2	2
	ישיבת מחנכות	אפרתי לימור	2	2
	ישיבת מחנכות	חדד חוה	2	2
	ישיבת הנהלה	אפרתי לימור	2	2
	ישיבת הנהלה	נאמן עדי	2	2
	ישיבת הנהלה	קולטון אושרית	2	2
	ישיבת הנהלה	חדד חוה	2	2
	ישיבת הנהלה	קרואני יערית	2	2
	ישיבת הנהלה	אפרתי לימור	2	2
	ישיבת הנהלה	סימקוביץ שולמית	2	2
	ישיבת הנהלה	אסולין חדוה גילה	2	2
	ישיבת הנהלה	סעד ליאל עיושה	2	2
	ישיבת הנהלה	בוחניק שילת	2	2
	ישיבת שכבה ז	חדד חוה	1	1
	ישיבת שכבה ז	נאמן עדי	1	1
	ישיבת שכבה ז	קרואני יערית	1	1
	ישיבת שכבה ז	עליאש גולדי	1	1
	ישיבת שכבה ז	שיוביץ אושרית	1	1
	ישיבת שכבה ח	חדד חוה	1	1
	ישיבת שכבה ח	נאמן עדי	1	1
	ישיבת שכבה ח	קרואני יערית	1	1
	ישיבת שכבה ח	דמרי זוהר	1	1
	ישיבת שכבה ח	בן שטרית מוריה	1	1
	ישיבת שכבה ט	נאמן עדי	1	1
	ישיבת שכבה ט	קולטון אושרית	1	1
	ישיבת שכבה ט	קרואני יערית	1	1
	ישיבת שכבה ט	רוזנפלד כנרת נינה	1	1
	ישיבת שכבה ט	בר כהן תמר	1	1
	ישיבת שכבה י	חדד חוה	1	1
	ישיבת שכבה י	קולטון אושרית	1	1
	ישיבת שכבה י	אפרתי לימור	1	1
	ישיבת שכבה י	אלפה עינב	1	1
	ישיבת שכבה י	למברגר אודיה	1	1
	ישיבת שכבה יא	חדד חוה	1	1
	ישיבת שכבה יא	קולטון אושרית	1	1
	ישיבת שכבה יא	אפרתי לימור	1	1
	ישיבת שכבה יא	אלמסי בת אל	1	1
	ישיבת שכבה יא	נאמן חנה אביגיל	1	1
	ישיבת שכבה יב	חדד חוה	1	1
	ישיבת שכבה יב	קולטון אושרית	1	1
	ישיבת שכבה יב	אפרתי לימור	1	1
	ישיבת שכבה יב	כהן אלגריה גילה	1	1
	ישיבת שכבה יב	בוחניק שילת	1	1
	ישיבת רכזים	אסולין חדוה גילה	1	1
	ישיבת רכזים	קולטון אושרית	1	1
	ישיבת רכזים	נאמן עדי	1	1
	ישיבת רכזים	הלימי עינב	1	1
	ישיבת רכזים	הראל חיים קלוד	1	1
	ישיבת רכזים	קדוש סמדר	1	1
	ישיבת רכזים	גרוס אדרת תקוה	1	1
	ישיבת רכזים	עידן שרה נדיה ז'אן אליס	1	1
	ישיבת רכזים	מטלון רבקי	0	1
	ישיבת רכזים	נאמן חנה אביגיל	1	1
	ישיבת רכזים	כהן אלגריה גילה	1	1
	ישיבת צוות מתמטיקה	קדוש סמדר	1	1
	ישיבת צוות מתמטיקה	אסולין חדוה גילה	1	1
	ישיבת צוות מתמטיקה	גרוס אדרת תקוה	1	1
	ישיבת צוות מתמטיקה	בוקריס אילנה	1	1
	ישיבת צוות מתמטיקה	פוקר רחל	1	1
	ישיבת צוות מתמטיקה	סויסה רויטל	1	1
	ישיבת צוות מתמטיקה	עליאש גולדי	1	1
	ישיבת צוות מתמטיקה	בוחבוט צופיה	1	1
	ישיבת מנהלות	קולטון אושרית	1	1
	ישיבת מנהלות	נאמן עדי	1	1
	ישיבה חברתי	קולטון אושרית	1	1
	ישיבה חברתי	חדד חוה	1	1
	ישיבה פדגוגיה	אסולין חדוה גילה	1	1
	ישיבה פדגוגיה	קולטון אושרית	1	1
	ישיבת יועצות	נאמן עדי	1	1
	ישיבת יועצות	קרואני יערית	1	1
	ישיבת יועצות	קולטון אושרית	1	1
	ישיבת יועצות	אפרתי לימור	1	1
	ישיבת יועצות	קולטון אושרית	1	1
	ישיבת יועצות	קרואני יערית	1	1
	ישיבת מחנכת יועצת	קרואני יערית	1	1
	ישיבת מחנכת יועצת	עליאש גולדי	1	1
	ישיבת מחנכת יועצת	קרואני יערית	1	1
	ישיבת מחנכת יועצת	שיוביץ אושרית	1	1
	ישיבת מחנכת יועצת	קרואני יערית	1	1
	ישיבת מחנכת יועצת	דמרי זוהר	1	1
	ישיבת מחנכת יועצת	קרואני יערית	1	1
	ישיבת מחנכת יועצת	בן שטרית מוריה	1	1
	ישיבת מחנכת יועצת	קרואני יערית	1	1
	ישיבת מחנכת יועצת	רוזנפלד כנרת נינה	1	1
	ישיבת מחנכת יועצת	אפרתי לימור	1	1
	ישיבת מחנכת יועצת	למברגר אודיה	1	1
	ישיבת מחנכת יועצת	אפרתי לימור	1	1
	ישיבת מחנכת יועצת	אלמסי בת אל	1	1
	ישיבת מחנכת יועצת	אפרתי לימור	1	1
	ישיבת מחנכת יועצת	בוחניק שילת	1	1
	ישיבת צוות אנגלית	עטיה הודיה	1	1
	ישיבת צוות אנגלית	פרוכטר שירה	1	1
	ישיבת צוות אנגלית	עידן שרה נדיה ז'אן אליס	1	1
	ישיבת צוות אנגלית	כהן אחינעם	1	1
	ישיבת צוות אנגלית	רביבו יוכבד שושנה	1	1
	ישיבת צוות אנגלית	עשוש אביה-מרים	1	1
	ישיבת צוות מדעים	הלימי עינב	1	1
	ישיבת צוות מדעים	בוחניק שילת	1	1
	ישיבת צוות מדעים	אלמליח חדוה	1	1
	ישיבת צוות לשון	נאמן חנה אביגיל	1	1
	ישיבת צוות לשון	קרים מורג	1	1
	ישיבת צוות לשון	שיוביץ אושרית	1	1
	ישיבת צוות לשון	הראל חיים קלוד	1	1
	ישיבת צוות תושבע	סויסה רויטל	1	1
	ישיבת צוות תושבע	בן שטרית מוריה	1	1
	ישיבת צוות תושבע	כהן אלגריה גילה	1	1
	ישיבת צוות תושבע	נאמן חנה אביגיל	1	1
	ישיבת צוות תנך - חט"ע	אלפה עינב	1	1
	ישיבת צוות תנך - חט"ע	למברגר אודיה	1	1
	ישיבת צוות תנך - חט"ע	נאמן חנה אביגיל	1	1
	ישיבת צוות תנך - חט"ע	אלמסי בת אל	1	1
	ישיבת צוות תנך - חט"ע	כהן אלגריה גילה	1	1
	ישיבת צוות תנך - חט"ע	בוחניק שילת	1	1
	ישיבת צוות תנך - חט"ע	רוזנפלד כנרת נינה	1	1
	ישיבת צוות תנך - חט"ע	בר כהן תמר	1	1
	ישיבת צוות תנך - חט"ב	עליאש גולדי	1	1
	ישיבת צוות תנך - חט"ב	שיוביץ אושרית	1	1
	ישיבת צוות תנך - חט"ב	דמרי זוהר	1	1
	ישיבת צוות תנך - חט"ב	כהן אלגריה גילה	1	1
	ישיבת צוות תנך - חט"ב	בן שטרית מוריה	1	1
	ישיבת צוות תנך - חט"ב	בן דוד רות	1	1
	ישיבת צוות תנך - חט"ב	אלמליח חדוה	1	1
ז' 1	שילוב	מוטרו מור	2	2
ז' 2	שילוב	מוטרו מור	2	2
ח' 1	שילוב	מוטרו מור	2	2
ח' 2	שילוב	מוטרו מור	3	3
ט' 1	שילוב	מוטרו מור	2	2
ט' 2	שילוב	מוטרו מור	2	2
	מליאה	נאמן עדי	2	2
	מליאה	עליאש גולדי	2	2
	מליאה	שיוביץ אושרית	2	2
	מליאה	דמרי זוהר	2	2
	מליאה	בן שטרית מוריה	2	2
	מליאה	רוזנפלד כנרת נינה	2	2
	מליאה	בר כהן תמר	2	2
	מליאה	אלפה עינב	2	2
	מליאה	למברגר אודיה	2	2
	מליאה	נאמן חנה אביגיל	2	2
	מליאה	אלמסי בת אל	2	2
	מליאה	כהן אלגריה גילה	2	2
	מליאה	בוחניק שילת	2	2
	מליאה	קרואני יערית	2	2
	מליאה	סעד ליאל עיושה	2	2
	מליאה	קולטון אושרית	2	2
	מליאה	חדד חוה	2	2
	מליאה	אפרתי לימור	2	2
	מליאה	אדרי מירב	2	2
	מליאה	אסולין חדוה גילה	2	2
	מליאה	אלמליח חדוה	2	2
	מליאה	בן דוד רות	2	2
	מליאה	הלימי עינב	2	2
	מליאה	גרוס אדרת תקוה	2	2
	מליאה	הראל חיים קלוד	2	2
	מליאה	וידבסקי דליה	2	2
	מליאה	יפרח יהודה אוהד	2	2
	מליאה	כהן אחינעם	2	2
	מליאה	כהן יוסף חיים	2	2
	מליאה	לילינטל אריאלה מרים	2	2
	מליאה	מוטרו מור	2	2
	מליאה	מטלון רבקי	2	2
	מליאה	נחום אחינעם	2	2
	מליאה	בוחבוט צופיה	2	2
	מליאה	שיוביץ אושרית	2	2
	מליאה	רביבו יוכבד שושנה	2	2
	מליאה	קרים מורג	2	2
	מליאה	קליינברג מרדכי	2	2
	מליאה	קדוש סמדר	2	2
	מליאה	צור הודיה	2	2
	מליאה	פרוכטר שירה	2	2
	מליאה	פוקר רחל	2	2
	מליאה	עשוש אביה-מרים	2	2
	מליאה	עידן שרה נדיה ז'אן אליס	2	2
	מליאה	עטיה הודיה	2	2
	מליאה	סימקוביץ שולמית	2	2
	מליאה	אפרתי לימור	2	2
	מליאה	סויסה רויטל	2	2
	ישיבת מזכירות	קולטון אושרית	1	1
	ישיבת מזכירות	סימקוביץ שולמית	1	1
	ישיבת מזכירות	קולטון אושרית	1	1
	ישיבת מזכירות	שרון מרים	0	1
	ישבת רבניות	קולטון אושרית	1	1
	ישבת רבניות	סעד ליאל עיושה	1	1
ז' 1, ז' 2, ח' 1, ח' 2	קומי אורי	סעד ליאל עיושה	2	2
י' 1, י' 2	חקר	וידבסקי דליה	2	2
יא' 1, יא' 2	חקר	וידבסקי דליה	2	2
יב' 1, יב' 2	חקר	וידבסקי דליה	1	1
י' 1	תעבורה	אדרי מירב	2	2
י' 2	תעבורה	אדרי מירב	2	2
ז' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
ט' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
ז' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
ט' 1	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
י' 1	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
ט' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
יב' 1	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
יא' 1	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
י' 1, י' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
ז' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
י' 1, י' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
י' 1, י' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	2	2
יא' 1, יא' 2	מענה רגשי לתלמידים וצוותים	מענה רגשי	1	1
י' 1, י' 2	הייטק	ברט עדינה	1	1
יא' 1	ספרות	בר כהן תמר	3	4
יא' 2	ספרות	בר כהן תמר	3	4
יב' 1, יב' 2	מחשבת ישראל	לילינטל אריאלה מרים	3	3
""".strip()

# ── Exclusion list ──────────────────────────────────────────────────────────
EXCLUDED_SUBJECTS = {
    "פרטני", "שהייה", "תפילה", "שיחות אישיות", "הכנת חומרים",
    "פרטני אופק", "פרטני עוז", "שעת רבנית", "שעת מדריכה",
    "קרן אור", "תכנית אל\"ה", "כישורי חיים",
    "מכינה לחיים", "מעורבות חברתית",
}

# Subjects that are external (don't block class time)
EXTERNAL_SUBJECTS = {"שילוב", "מענה רגשי לתלמידים וצוותים"}

# Meeting name patterns (no class assignment, subject starts with these)
MEETING_PREFIXES = ("ישיבת", "ישיבה", "ישבת", "מליאה")

# Megama (specialization) subjects — these run simultaneously as one block per grade.
# Students choose ONE megama and all tracks run at the same timeslots.
MEGAMA_ROOTS = {
    "ביולוגיה", "פיזיקה", "קולנוע", "הייטק",
    "מדעי המחשב", "תיאטרון", "ארץ ישראל",
}

# ── Grade mapping ───────────────────────────────────────────────────────────
GRADE_MAP = {
    "ז'": ("ז", 7),
    "ח'": ("ח", 8),
    "ט'": ("ט", 9),
    "י'": ("י", 10),
    "יא'": ("יא", 11),
    "יב'": ("יב", 12),
}

# Subject color palette
SUBJECT_COLORS = [
    "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
    "#EC4899", "#06B6D4", "#F97316", "#6366F1", "#14B8A6",
    "#E11D48", "#84CC16", "#0EA5E9", "#A855F7", "#D946EF",
    "#22D3EE", "#FB923C", "#4ADE80", "#818CF8", "#F472B6",
]


def parse_class_refs(classes_str: str) -> list[str]:
    """Parse 'ז' 1, ז' 2' into ['ז' 1', 'ז' 2']."""
    if not classes_str.strip():
        return []
    return [c.strip() for c in classes_str.split(",") if c.strip()]


def class_ref_to_grade_and_num(ref: str) -> tuple[str, int]:
    """Parse 'ז' 1' → ('ז'', 1)."""
    ref = ref.strip()
    # Match grade prefix (with ') and number
    match = re.match(r"^([\u0590-\u05FF]+'?)\s+(\d+)$", ref)
    if match:
        return match.group(1), int(match.group(2))
    raise ValueError(f"Cannot parse class ref: {ref!r}")


def normalize_subject_name(name: str) -> str:
    """Normalize subject names for grouping.

    For grouping clusters, we use the track-specific name as-is.
    For the parent Subject entity, we use the base name.
    """
    return name.strip()


def get_root_subject_name(name: str) -> str:
    """Get the ROOT subject name for creating Subject entities and grouping clusters.

    E.g., 'מתמטיקה 5 יח' → 'מתמטיקה', 'אנגלית א1' → 'אנגלית',
    'תנ"ך 3 יח' → 'תנ"ך', 'קולנוע עיוני' → 'קולנוע'.
    """
    name = name.strip()

    # Subjects that should keep their full name (not strip suffix)
    keep_full = {
        "סיירת תנ\"ך",  # Different from תנ"ך
        "חינוך גופני",   # Different from חינוך
        "מחשבת ישראל",
        "מדעי המחשב",
        "ארץ ישראל",
        "דמויות מופת",
        "צעיר בספיר",
        "קומי אורי",
        "מענה רגשי לתלמידים וצוותים",
    }
    if name in keep_full:
        return name

    # Roots to detect — sorted longest first to avoid prefix conflicts
    roots = [
        "מתמטיקה", "אנגלית", "תושב\"ע", "תנ\"ך", "קולנוע",
        "תורה", "מדעים", "מרחב", "נפגשות", "אמירים",
        "התנדבות", "אל\"ה",
    ]
    for root in sorted(roots, key=len, reverse=True):
        if name == root or name.startswith(root + " "):
            return root

    return name


def is_meeting_entry(classes_str: str, subject: str) -> bool:
    """Check if this is a meeting entry (no class, subject is a meeting name)."""
    if classes_str.strip():
        return False
    subject = subject.strip()
    return any(subject.startswith(p) for p in MEETING_PREFIXES) or subject == "מליאה"


def is_excluded(subject: str) -> bool:
    """Check if subject should be excluded."""
    subject = subject.strip()
    if not subject:
        return True
    if subject in EXCLUDED_SUBJECTS:
        return True
    # Also exclude anything starting with "פרטני"
    if subject.startswith("פרטני"):
        return True
    return False


def parse_rows():
    """Parse raw data into structured rows."""
    rows = []
    for line in RAW_DATA.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        classes_str = parts[0].strip()
        subject = parts[1].strip()
        teacher = parts[2].strip()
        try:
            scheduled = int(float(parts[3].strip())) if parts[3].strip() else 0
        except (ValueError, IndexError):
            scheduled = 0

        rows.append({
            "classes": classes_str,
            "subject": subject,
            "teacher": teacher,
            "scheduled": scheduled,
        })
    return rows


def run_import():
    db = SessionLocal()

    try:
        # ── Use existing school ─────────────────────────────────────────
        school = db.query(School).first()
        if not school:
            school = School(name="בית ספר ספיר")
            db.add(school)
            db.flush()
        school_id = school.id
        print(f"Using school: {school.name} (id={school_id})")

        # ── Delete existing data (fresh import) ────────────────────────
        # Delete in reverse dependency order
        db.query(Constraint).filter(Constraint.school_id == school_id).delete()
        db.query(SubjectRequirement).filter(SubjectRequirement.school_id == school_id).delete()
        db.execute(meeting_teachers.delete())
        db.query(Meeting).filter(Meeting.school_id == school_id).delete()
        db.query(Track).filter(
            Track.cluster_id.in_(
                db.query(GroupingCluster.id).filter(GroupingCluster.school_id == school_id)
            )
        ).delete(synchronize_session=False)
        db.execute(
            cluster_source_classes.delete().where(
                cluster_source_classes.c.cluster_id.in_(
                    db.query(GroupingCluster.id).filter(GroupingCluster.school_id == school_id)
                )
            )
        )
        db.query(GroupingCluster).filter(GroupingCluster.school_id == school_id).delete()
        db.execute(teacher_subjects.delete())
        db.query(Teacher).filter(Teacher.school_id == school_id).delete()
        db.query(Subject).filter(Subject.school_id == school_id).delete()
        db.query(ClassGroup).filter(ClassGroup.school_id == school_id).delete()
        db.query(Grade).filter(Grade.school_id == school_id).delete()
        db.flush()
        print("Cleared existing data")

        # ── Parse all rows ──────────────────────────────────────────────
        rows = parse_rows()
        print(f"Parsed {len(rows)} rows")

        # ── Create grades and classes ───────────────────────────────────
        grade_objs: dict[str, Grade] = {}  # "ז'" → Grade
        class_objs: dict[str, ClassGroup] = {}  # "ז' 1" → ClassGroup

        # Collect all class references
        all_class_refs: set[str] = set()
        for row in rows:
            for ref in parse_class_refs(row["classes"]):
                all_class_refs.add(ref)

        # Create grades first
        for ref in sorted(all_class_refs):
            grade_prefix, num = class_ref_to_grade_and_num(ref)
            if grade_prefix not in grade_objs:
                grade_name, level = GRADE_MAP[grade_prefix]
                g = Grade(school_id=school_id, name=grade_name, level=level)
                db.add(g)
                db.flush()
                grade_objs[grade_prefix] = g
                print(f"  Grade: {grade_name} (level={level}, id={g.id})")

        # Create classes
        for ref in sorted(all_class_refs):
            grade_prefix, num = class_ref_to_grade_and_num(ref)
            grade = grade_objs[grade_prefix]
            cg = ClassGroup(
                school_id=school_id,
                name=f"{grade.name}' {num}",
                grade_id=grade.id,
                num_students=30,
            )
            db.add(cg)
            db.flush()
            class_objs[ref] = cg
            print(f"  Class: {cg.name} (id={cg.id})")

        # ── Collect all unique teachers ─────────────────────────────────
        teacher_names: set[str] = set()
        for row in rows:
            if row["teacher"] and not is_excluded(row["subject"]):
                teacher_names.add(row["teacher"])
        # Also from meetings
        for row in rows:
            if is_meeting_entry(row["classes"], row["subject"]) and row["teacher"]:
                teacher_names.add(row["teacher"])

        # Remove non-person entries
        teacher_names.discard("מדריכה ח")
        teacher_names.discard("מדריכה ט")
        teacher_names.discard("קרן אור")
        teacher_names.discard("מענה רגשי")

        teacher_objs: dict[str, Teacher] = {}
        for name in sorted(teacher_names):
            t = Teacher(school_id=school_id, name=name)
            db.add(t)
            db.flush()
            teacher_objs[name] = t

        print(f"Created {len(teacher_objs)} teachers")

        # ── Collect all unique subjects ─────────────────────────────────
        subject_names: set[str] = set()
        for row in rows:
            subj = row["subject"]
            if not subj or is_excluded(subj) or is_meeting_entry(row["classes"], subj):
                continue
            if not row["classes"]:  # No class and not a meeting = skip (כינוס without class)
                continue
            subject_names.add(get_root_subject_name(subj))

        subject_objs: dict[str, Subject] = {}
        color_idx = 0
        for name in sorted(subject_names):
            s = Subject(
                school_id=school_id,
                name=name,
                color=SUBJECT_COLORS[color_idx % len(SUBJECT_COLORS)],
            )
            db.add(s)
            db.flush()
            subject_objs[name] = s
            color_idx += 1

        print(f"Created {len(subject_objs)} subjects")

        # ── Separate rows into: single-class, multi-class (groupings), meetings ──
        single_class_rows = []
        # Group multi-class entries by (classes_key, ROOT_subject) so that
        # "אנגלית א1", "אנגלית א2", "אנגלית ב'" all merge into one cluster
        multi_class_groups: dict[tuple[str, str], list[dict]] = {}
        meeting_rows: dict[str, list[dict]] = {}  # meeting_name → rows

        for row in rows:
            subj = row["subject"]
            if not subj or is_excluded(subj):
                continue

            # Meetings (no class, meeting subject)
            if is_meeting_entry(row["classes"], subj):
                if row["scheduled"] > 0 and row["teacher"]:
                    meeting_rows.setdefault(subj, []).append(row)
                continue

            class_refs = parse_class_refs(row["classes"])
            if not class_refs:
                continue  # Skip rows with no class (like כינוס without class)

            if row["scheduled"] <= 0:
                continue  # Only use שובץ > 0

            if row["teacher"] in ("מדריכה ח", "מדריכה ט", "קרן אור", "מענה רגשי"):
                if row["teacher"] == "מענה רגשי":
                    continue
                continue

            if not row["teacher"]:
                continue  # No teacher assigned

            if len(class_refs) == 1:
                single_class_rows.append(row)
            else:
                # Multi-class = grouping — key by ROOT subject name
                classes_key = row["classes"]
                root_subj = get_root_subject_name(subj)
                multi_class_groups.setdefault((classes_key, root_subj), []).append(row)

        # ── Create single-class requirements ────────────────────────────
        # Aggregate by (class_ref, root_subject, teacher)
        req_agg: dict[tuple[str, str, str], int] = {}
        for row in single_class_rows:
            ref = parse_class_refs(row["classes"])[0]
            key = (ref, get_root_subject_name(row["subject"]), row["teacher"])
            req_agg[key] = req_agg.get(key, 0) + row["scheduled"]

        teacher_subject_pairs: set[tuple[int, int]] = set()
        req_count = 0
        for (class_ref, subj_name, teacher_name), hours in req_agg.items():
            if hours <= 0:
                continue
            cg = class_objs.get(class_ref)
            subj = subject_objs.get(subj_name)
            teacher = teacher_objs.get(teacher_name)
            if not cg or not subj or not teacher:
                print(f"  SKIP req: class={class_ref}, subj={subj_name}, teacher={teacher_name}")
                continue

            is_ext = subj_name in EXTERNAL_SUBJECTS
            sr = SubjectRequirement(
                school_id=school_id,
                class_group_id=cg.id,
                subject_id=subj.id,
                teacher_id=teacher.id,
                hours_per_week=hours,
                is_grouped=False,
                is_external=is_ext,
            )
            db.add(sr)
            teacher_subject_pairs.add((teacher.id, subj.id))
            req_count += 1

        db.flush()
        print(f"Created {req_count} single-class requirements")

        # ── Create grouping clusters ────────────────────────────────────
        cluster_count = 0
        track_count = 0

        # Separate megama entries from regular groupings
        megama_groups: dict[str, list[dict]] = {}  # classes_key → all megama rows
        regular_multi_class: dict[tuple[str, str], list[dict]] = {}

        for (classes_key, root_subj_name), group_rows in multi_class_groups.items():
            if root_subj_name in MEGAMA_ROOTS:
                megama_groups.setdefault(classes_key, []).extend(group_rows)
            else:
                regular_multi_class[(classes_key, root_subj_name)] = group_rows

        # Track which clusters we've already created (by name) to avoid duplicates
        created_clusters: dict[str, GroupingCluster] = {}

        # --- Process regular groupings (math, English, etc.) ---
        for (classes_key, root_subj_name), group_rows in regular_multi_class.items():
            class_refs = parse_class_refs(classes_key)
            source_classes = [class_objs[ref] for ref in class_refs if ref in class_objs]
            if not source_classes:
                continue

            subj = subject_objs.get(root_subj_name)
            if not subj:
                print(f"  SKIP cluster: no subject for {root_subj_name}")
                continue

            # Build cluster name from grade + subject
            grade_labels = set()
            for ref in class_refs:
                grade_prefix, _ = class_ref_to_grade_and_num(ref)
                grade_labels.add(GRADE_MAP[grade_prefix][0])
            grade_str = ", ".join(sorted(grade_labels))
            cluster_name = f"הקבצת {root_subj_name} {grade_str}"

            # Check if we already created this cluster
            if cluster_name in created_clusters:
                cluster = created_clusters[cluster_name]
            else:
                cluster = GroupingCluster(
                    school_id=school_id,
                    name=cluster_name,
                    subject_id=subj.id,
                )
                db.add(cluster)
                db.flush()

                # Add source classes
                for sc in source_classes:
                    db.execute(
                        cluster_source_classes.insert().values(
                            cluster_id=cluster.id, class_group_id=sc.id,
                        )
                    )
                created_clusters[cluster_name] = cluster
                cluster_count += 1

            # Create tracks — each row with a different teacher = a track
            track_agg: dict[str, tuple[str, int]] = {}  # teacher → (track_name, hours)
            for row in group_rows:
                t_name = row["teacher"]
                if not t_name or t_name not in teacher_objs:
                    continue
                track_label = row["subject"]
                existing_hours = track_agg.get(t_name, (track_label, 0))[1]
                track_agg[t_name] = (track_label, existing_hours + row["scheduled"])

            for t_name, (track_label, hours) in track_agg.items():
                if hours <= 0:
                    continue
                teacher = teacher_objs[t_name]
                track = Track(
                    name=track_label,
                    cluster_id=cluster.id,
                    teacher_id=teacher.id,
                    hours_per_week=hours,
                )
                db.add(track)
                teacher_subject_pairs.add((teacher.id, subj.id))
                track_count += 1

            # Create grouped SubjectRequirements for each source class
            if cluster_name not in created_clusters or cluster == created_clusters[cluster_name]:
                existing_grouped = db.query(SubjectRequirement).filter(
                    SubjectRequirement.grouping_cluster_id == cluster.id,
                ).count()
                if existing_grouped == 0:
                    for sc in source_classes:
                        sr = SubjectRequirement(
                            school_id=school_id,
                            class_group_id=sc.id,
                            subject_id=subj.id,
                            teacher_id=None,
                            hours_per_week=0,
                            is_grouped=True,
                            grouping_cluster_id=cluster.id,
                            is_external=root_subj_name in EXTERNAL_SUBJECTS,
                        )
                        db.add(sr)

        # --- Process megama groups — one cluster per classes_key ---
        # Create a "מגמות" subject for mega-clusters
        megama_subject = None
        if megama_groups:
            megama_subject = Subject(
                school_id=school_id,
                name="מגמות",
                color="#7C3AED",
            )
            db.add(megama_subject)
            db.flush()
            subject_objs["מגמות"] = megama_subject

        for classes_key, megama_rows in megama_groups.items():
            class_refs = parse_class_refs(classes_key)
            source_classes = [class_objs[ref] for ref in class_refs if ref in class_objs]
            if not source_classes:
                continue

            # Build cluster name from grades
            grade_labels = set()
            for ref in class_refs:
                grade_prefix, _ = class_ref_to_grade_and_num(ref)
                grade_labels.add(GRADE_MAP[grade_prefix][0])
            grade_str = ", ".join(sorted(grade_labels))
            cluster_name = f"מגמות {grade_str}"

            if cluster_name in created_clusters:
                cluster = created_clusters[cluster_name]
            else:
                cluster = GroupingCluster(
                    school_id=school_id,
                    name=cluster_name,
                    subject_id=megama_subject.id,
                )
                db.add(cluster)
                db.flush()

                for sc in source_classes:
                    db.execute(
                        cluster_source_classes.insert().values(
                            cluster_id=cluster.id, class_group_id=sc.id,
                        )
                    )
                created_clusters[cluster_name] = cluster
                cluster_count += 1

            # Aggregate megama tracks by (root_subject, teacher)
            # Same teacher teaching same root subject → one track
            track_agg: dict[tuple[str, str], tuple[str, int]] = {}
            for row in megama_rows:
                t_name = row["teacher"]
                if not t_name or t_name not in teacher_objs:
                    continue
                root_subj = get_root_subject_name(row["subject"])
                key = (root_subj, t_name)
                existing = track_agg.get(key, (row["subject"], 0))
                track_agg[key] = (existing[0], existing[1] + row["scheduled"])

            for (root_subj, t_name), (track_label, hours) in track_agg.items():
                if hours <= 0:
                    continue
                teacher = teacher_objs[t_name]
                track = Track(
                    name=track_label,
                    cluster_id=cluster.id,
                    teacher_id=teacher.id,
                    hours_per_week=hours,
                )
                db.add(track)
                # Link teacher to the specific megama subject
                subj = subject_objs.get(root_subj)
                if subj:
                    teacher_subject_pairs.add((teacher.id, subj.id))
                teacher_subject_pairs.add((teacher.id, megama_subject.id))
                track_count += 1

            # Create grouped SubjectRequirements
            existing_grouped = db.query(SubjectRequirement).filter(
                SubjectRequirement.grouping_cluster_id == cluster.id,
            ).count()
            if existing_grouped == 0:
                for sc in source_classes:
                    sr = SubjectRequirement(
                        school_id=school_id,
                        class_group_id=sc.id,
                        subject_id=megama_subject.id,
                        teacher_id=None,
                        hours_per_week=0,
                        is_grouped=True,
                        grouping_cluster_id=cluster.id,
                    )
                    db.add(sr)

        db.flush()
        print(f"Created {cluster_count} grouping clusters with {track_count} tracks")

        # ── Create teacher-subject associations ─────────────────────────
        for teacher_id, subject_id in teacher_subject_pairs:
            db.execute(
                teacher_subjects.insert().values(
                    teacher_id=teacher_id, subject_id=subject_id,
                )
            )
        db.flush()
        print(f"Created {len(teacher_subject_pairs)} teacher-subject associations")

        # ── Create meetings ─────────────────────────────────────────────
        # Group meetings: each unique meeting name becomes one Meeting entity
        # The "ישיבת מחנכת יועצת" entries are paired (counselor+teacher), treat as separate meetings
        meeting_count = 0

        # Special handling for ישיבת מחנכת יועצת — these come in pairs
        machnehet_yoetzet_pairs: list[tuple[str, str]] = []
        regular_meetings: dict[str, set[str]] = {}  # meeting_name → set of teachers

        for meeting_name, m_rows in meeting_rows.items():
            if meeting_name == "ישיבת מחנכת יועצת":
                # These come in pairs of 2 rows (counselor + homeroom teacher)
                current_pair: list[str] = []
                for row in m_rows:
                    current_pair.append(row["teacher"])
                    if len(current_pair) == 2:
                        machnehet_yoetzet_pairs.append(tuple(current_pair))
                        current_pair = []
            else:
                teachers_set = set()
                for row in m_rows:
                    if row["teacher"] and row["teacher"] in teacher_objs:
                        teachers_set.add(row["teacher"])
                if teachers_set:
                    regular_meetings[meeting_name] = teachers_set

        # Create regular meetings
        for meeting_name, teacher_set in regular_meetings.items():
            # Determine meeting type
            if "הנהלה" in meeting_name or "מנהלות" in meeting_name:
                mt = MeetingType.MANAGEMENT
            elif "מחנכות" in meeting_name or "מליאה" in meeting_name:
                mt = MeetingType.HOMEROOM
            elif "רכזים" in meeting_name:
                mt = MeetingType.COORDINATORS
            else:
                mt = MeetingType.CUSTOM

            # Hours: all rows in same meeting have same hours, take first
            hours = meeting_rows[meeting_name][0]["scheduled"]
            if hours <= 0:
                hours = 1  # Default

            m = Meeting(
                school_id=school_id,
                name=meeting_name,
                meeting_type=mt,
                hours_per_week=hours,
                is_active=True,
            )
            db.add(m)
            db.flush()

            for t_name in teacher_set:
                t = teacher_objs.get(t_name)
                if t:
                    db.execute(
                        meeting_teachers.insert().values(
                            meeting_id=m.id, teacher_id=t.id,
                        )
                    )
            meeting_count += 1

        # Create ישיבת מחנכת יועצת meetings (one per pair)
        for i, (t1, t2) in enumerate(machnehet_yoetzet_pairs, 1):
            teacher1 = teacher_objs.get(t1)
            teacher2 = teacher_objs.get(t2)
            if not teacher1 or not teacher2:
                continue

            m = Meeting(
                school_id=school_id,
                name=f"ישיבת מחנכת יועצת - {teacher2.name}",
                meeting_type=MeetingType.CUSTOM,
                hours_per_week=1,
                is_active=True,
            )
            db.add(m)
            db.flush()

            db.execute(meeting_teachers.insert().values(meeting_id=m.id, teacher_id=teacher1.id))
            db.execute(meeting_teachers.insert().values(meeting_id=m.id, teacher_id=teacher2.id))
            meeting_count += 1

        db.flush()
        print(f"Created {meeting_count} meetings")

        # ── Set teacher role flags ─────────────────────────────────────
        # Homeroom: from חינוך entries (single-class, teacher = homeroom teacher)
        homeroom_map: dict[str, str] = {}  # class_ref → teacher_name
        for row in rows:
            root = get_root_subject_name(row["subject"])
            if root == "חינוך" and row["classes"].strip():
                refs = parse_class_refs(row["classes"])
                if len(refs) == 1 and row["teacher"] in teacher_objs:
                    # Use first teacher found per class
                    homeroom_map.setdefault(refs[0], row["teacher"])

        homeroom_count = 0
        for class_ref, teacher_name in homeroom_map.items():
            cg = class_objs.get(class_ref)
            teacher = teacher_objs.get(teacher_name)
            if cg and teacher:
                teacher.homeroom_class_id = cg.id
                homeroom_count += 1

        # Coordinator: from ישיבת רכזים members
        # Management: from ישיבת הנהלה / ישיבת מנהלות members
        coordinator_count = 0
        management_count = 0
        for m_name, teacher_set in regular_meetings.items():
            for t_name in teacher_set:
                teacher = teacher_objs.get(t_name)
                if not teacher:
                    continue
                if "רכזים" in m_name:
                    teacher.is_coordinator = True
                    coordinator_count += 1
                elif "הנהלה" in m_name or "מנהלות" in m_name:
                    teacher.is_management = True
                    management_count += 1

        db.flush()
        print(f"Set role flags: {homeroom_count} homeroom, {coordinator_count} coordinators, {management_count} management")

        # ── Update teacher hours ────────────────────────────────────────
        # Calculate actual total hours per teacher from requirements + tracks + meetings
        teacher_total_hours: dict[int, int] = {}

        # From regular requirements
        for sr in db.query(SubjectRequirement).filter(
            SubjectRequirement.school_id == school_id,
            SubjectRequirement.is_grouped == False,
            SubjectRequirement.teacher_id.isnot(None),
        ).all():
            teacher_total_hours[sr.teacher_id] = (
                teacher_total_hours.get(sr.teacher_id, 0) + sr.hours_per_week
            )

        # From tracks (grouping clusters)
        for track in db.query(Track).join(GroupingCluster).filter(
            GroupingCluster.school_id == school_id,
            Track.teacher_id.isnot(None),
        ).all():
            teacher_total_hours[track.teacher_id] = (
                teacher_total_hours.get(track.teacher_id, 0) + track.hours_per_week
            )

        # From meetings
        for m in db.query(Meeting).filter(Meeting.school_id == school_id).all():
            for t in m.teachers:
                teacher_total_hours[t.id] = (
                    teacher_total_hours.get(t.id, 0) + m.hours_per_week
                )

        # Update each teacher's max_hours_per_week
        for t_name, teacher in teacher_objs.items():
            total = teacher_total_hours.get(teacher.id, 0)
            teacher.max_hours_per_week = total

        db.flush()
        print(f"Updated teaching hours for {len(teacher_total_hours)} teachers")

        # ── Create constraints: at least 1 free day per teacher ────────
        constraint_count = 0
        for t_name, teacher in teacher_objs.items():
            total = teacher_total_hours.get(teacher.id, 0)
            if total <= 0:
                continue  # No teaching hours — no need for free day constraint
            c = Constraint(
                school_id=school_id,
                name=f"יום חופשי - {teacher.name}",
                category="TEACHER",
                type=ConstraintType.HARD,
                weight=100,
                rule_type=RuleType.MIN_FREE_DAYS,
                parameters={"min_days": 1},
                target_type="TEACHER",
                target_id=teacher.id,
                is_active=True,
            )
            db.add(c)
            constraint_count += 1

        db.flush()
        print(f"Created {constraint_count} free-day constraints (MIN_FREE_DAYS >= 1)")

        # ── Summary ─────────────────────────────────────────────────────
        print("\n=== Import Summary ===")
        print(f"School: {school.name} (id={school_id})")
        print(f"Grades: {len(grade_objs)}")
        print(f"Classes: {len(class_objs)}")
        print(f"Teachers: {len(teacher_objs)}")
        print(f"Subjects: {len(subject_objs)}")
        print(f"Single-class requirements: {req_count}")
        print(f"Grouping clusters: {cluster_count}")
        print(f"Tracks: {track_count}")
        print(f"Meetings: {meeting_count}")

        db.commit()
        print("\nImport committed successfully!")

    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run_import()
