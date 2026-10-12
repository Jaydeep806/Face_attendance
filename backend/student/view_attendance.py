from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
import time

attendance_bp = Blueprint("attendance", __name__)

def _is_student_present(student_entry):
    return bool(
        student_entry.get("present")
        or student_entry.get("entry_present")
        or student_entry.get("exit_present")
    )

def _serialize_time(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)

# ------------------------- GET ATTENDANCE -------------------------
@attendance_bp.route('/api/attendance', methods=['GET'])
def get_attendance():
    db = current_app.config.get("DB")
    attendance_col = current_app.config.get("ATTENDANCE_COLLECTION")
    if attendance_col is None:
        attendance_col = db.attendance_records
    students_col = db.students

    date = request.args.get('date')
    department = request.args.get('department')
    year = request.args.get('year')
    division = request.args.get('division')
    subject = request.args.get('subject')
    student_id = request.args.get('student_id')

    try:
        # Query attendance collection
        query = {}
        if date: query["date"] = date
        if department: query["department"] = department
        if year: query["year"] = year
        if division: query["division"] = division
        if subject: query["subject"] = subject

        attendance_doc = attendance_col.find_one(query)

        # Build roster from students collection for given class filters
        roster_filter = {}
        if department: roster_filter["department"] = department
        if year: roster_filter["year"] = year
        if division: roster_filter["division"] = division

        roster = list(students_col.find(roster_filter)) if roster_filter else []

        # Map session students by id for quick lookup
        session_map = {}
        if attendance_doc:
            for s in attendance_doc.get("students", []):
                sid = s.get("student_id")
                session_map[sid] = s

        attendance_list = []
        seen_students = set()

        # Merge roster and session students: show present and absent
        for student in roster:
            sid = student.get("studentId") or student.get("student_id")
            if not sid or sid in seen_students:
                continue
            seen_students.add(sid)
            # Apply student_id filter if provided
            if student_id and sid != student_id:
                continue

            sess = session_map.get(sid, None)
            if sess:
                present = _is_student_present(sess)
                marked_at = _serialize_time(sess.get("marked_at") or sess.get("entry_marked_at"))
            else:
                present = False
                marked_at = None

            attendance_list.append({
                "studentId": str(sid) if sid is not None else "",
                "studentName": student.get("studentName") or student.get("student_name"),
                "date": str(attendance_doc.get("date")) if attendance_doc else str(date or ""),
                "subject": str(attendance_doc.get("subject")) if attendance_doc else str(subject or ""),
                "department": str(attendance_doc.get("department")) if attendance_doc else str(department or ""),
                "year": str(attendance_doc.get("year")) if attendance_doc else str(year or ""),
                "division": str(attendance_doc.get("division")) if attendance_doc else str(division or ""),
                "status": "present" if present else "absent",
                "markedAt": marked_at,
                "entryTime": _serialize_time(sess.get("entry_marked_at")) if sess else None,
                "exitTime": _serialize_time(sess.get("exit_marked_at")) if sess else None
            })

        # Also include any session-only students not in roster (fallback)
        if attendance_doc:
            for s in attendance_doc.get("students", []):
                sid = s.get("student_id")
                if sid in seen_students:
                    continue
                if student_id and sid != student_id:
                    continue
                seen_students.add(sid)
                # Convert any datetime in s.get('marked_at') to string
                marked = _serialize_time(s.get("marked_at") or s.get("entry_marked_at"))

                attendance_list.append({
                    "studentId": str(sid) if sid is not None else "",
                    "studentName": s.get("student_name"),
                    "date": str(attendance_doc.get("date")),
                    "subject": str(attendance_doc.get("subject")),
                    "department": str(attendance_doc.get("department")),
                    "year": str(attendance_doc.get("year")),
                    "division": str(attendance_doc.get("division")),
                    "status": "present" if _is_student_present(s) else "absent",
                    "markedAt": marked,
                    "entryTime": _serialize_time(s.get("entry_marked_at")),
                    "exitTime": _serialize_time(s.get("exit_marked_at"))
                })

        # Stats computed against roster size
        student_filter = roster_filter
        total_students = students_col.count_documents(student_filter) if student_filter else 0
        present_count = sum(1 for r in attendance_list if r.get("status") == "present")
        absent_count = max(total_students - present_count, 0)
        attendance_rate = round((present_count / total_students * 100) if total_students > 0 else 0, 1)

        return jsonify({
            "success": True,
            "attendance": attendance_list,
            "stats": {
                "totalStudents": total_students,
                "presentToday": present_count,
                "absentToday": absent_count,
                "attendanceRate": attendance_rate
            }
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ------------------------- EXPORT TO EXCEL -------------------------
@attendance_bp.route('/api/attendance/export', methods=['GET'])
def export_attendance():
    db = current_app.config.get("DB")
    attendance_col = current_app.config.get("ATTENDANCE_COLLECTION")
    if attendance_col is None:
        attendance_col = db.attendance_records
    students_col = db.students

    date = request.args.get('date')
    department = request.args.get('department')
    year = request.args.get('year')
    division = request.args.get('division')
    subject = request.args.get('subject')

    try:
        query = {}
        if date: query["date"] = date
        if department: query["department"] = department
        if year: query["year"] = year
        if division: query["division"] = division
        if subject: query["subject"] = subject

        export_data = []
        sessions = list(attendance_col.find(query))

        if sessions:
            for session in sessions:
                session_student_filter = {}
                for field in ("department", "year", "division"):
                    value = query.get(field) or session.get(field)
                    if value:
                        session_student_filter[field] = value

                students_by_id = {}
                for student in students_col.find(session_student_filter):
                    sid = student.get("studentId") or student.get("student_id")
                    if sid is not None:
                        students_by_id[str(sid)] = student

                entries_by_id = {
                    str(entry.get("student_id")): entry
                    for entry in session.get("students", [])
                    if entry.get("student_id") is not None
                }

                for student_id in dict.fromkeys([*students_by_id, *entries_by_id]):
                    student = students_by_id.get(student_id, {})
                    entry = entries_by_id.get(student_id, {})
                    export_data.append({
                        "studentId": student_id,
                        "name": student.get("studentName") or student.get("student_name") or entry.get("student_name", ""),
                        "email": student.get("email", ""),
                        "phoneNumber": student.get("phoneNumber", ""),
                        "department": student.get("department") or session.get("department", ""),
                        "year": student.get("year") or session.get("year", ""),
                        "division": student.get("division") or session.get("division", ""),
                        "semester": student.get("semester", ""),
                        "subject": session.get("subject", ""),
                        "date": session.get("date", ""),
                        "sessionId": str(session.get("_id", "")),
                        "sessionStart": _serialize_time(session.get("created_at")),
                        "sessionEnd": _serialize_time(session.get("ended_at")),
                        "exitTimerMinutes": session.get("exit_timer_minutes", 0),
                        "entryTime": _serialize_time(entry.get("entry_marked_at") or entry.get("marked_at")),
                        "exitTime": _serialize_time(entry.get("exit_marked_at")),
                        "status": "present" if _is_student_present(entry) else "absent"
                    })
        else:
            student_filter = {}
            if department: student_filter["department"] = department
            if year: student_filter["year"] = year
            if division: student_filter["division"] = division

            for student in students_col.find(student_filter):
                sid = student.get("studentId") or student.get("student_id")
                export_data.append({
                    "studentId": str(sid) if sid is not None else "",
                    "name": student.get("studentName") or student.get("student_name", ""),
                    "email": student.get("email", ""),
                    "phoneNumber": student.get("phoneNumber", ""),
                    "department": student.get("department", ""),
                    "year": student.get("year", ""),
                    "division": student.get("division", ""),
                    "semester": student.get("semester", ""),
                    "subject": subject or "",
                    "date": date or "",
                    "sessionId": "",
                    "sessionStart": None,
                    "sessionEnd": None,
                    "exitTimerMinutes": 0,
                    "entryTime": None,
                    "exitTime": None,
                    "status": "absent"
                })

        return jsonify({"success": True, "data": export_data})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500