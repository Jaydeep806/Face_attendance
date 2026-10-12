from flask import Blueprint, request, jsonify, current_app
import time
import base64
import numpy as np
from PIL import Image
import io
from deepface import DeepFace
from bson.objectid import ObjectId
import logging

student_registration_bp = Blueprint("student_registration", __name__)
logger = logging.getLogger(__name__)

def read_image_from_bytes(b):
    img = Image.open(io.BytesIO(b)).convert('RGB')
    return np.array(img)

def detect_faces_rgb(rgb_image):
    detector = current_app.config["MODEL_MANAGER"].get_detector()
    detections = detector.detect_faces(rgb_image)
    faces = []
    for d in detections:
        if d['confidence'] > 0.9:
            x, y, w, h = d['box']
            x, y = max(0, x), max(0, y)
            if w > 50 and h > 50:
                face_rgb = rgb_image[y:y+h, x:x+w]
                faces.append({'box': (x, y, w, h), 'face': face_rgb, 'confidence': d['confidence']})
    return faces

def extract_embedding(face_rgb):
    try:
        face_pil = Image.fromarray(face_rgb.astype('uint8')).resize((160, 160))
        face_array = np.array(face_pil)
        rep = DeepFace.represent(face_array, model_name='Facenet512', detector_backend='skip')
        return np.array(rep[0]['embedding'], dtype=float)
    except Exception as e:
        print(f"Embedding error: {e}")
        return None

@student_registration_bp.route('/api/register-student', methods=['POST'])
def register_student():
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "Invalid JSON data"}), 400

    model_manager = current_app.config.get("MODEL_MANAGER")
    if not model_manager or not model_manager.is_ready():
        return jsonify({"success": False, "error": "Face recognition models are still initializing"}), 503

    # Get logged-in user info from headers
    # Simplified: only validate fields and ensure uniqueness of studentId and email
    db = current_app.config.get("DB")
    students_col = db.students

    # Check required fields
    required_fields = ['studentName', 'studentId', 'department', 'year', 'division', 'semester', 'email', 'phoneNumber', 'images']
    for field in required_fields:
        if not data.get(field):
            return jsonify({"success": False, "error": f"{field} is required"}), 400

    # Check uniqueness of studentId and email
    if students_col.find_one({'studentId': data['studentId']}):
        return jsonify({"success": False, "error": "Student ID already exists"}), 400
    if students_col.find_one({'email': data['email']}):
        return jsonify({"success": False, "error": "Email already registered"}), 400

    # Validate images
    images = data.get('images')
    if not isinstance(images, list) or len(images) != 5:
        return jsonify({"success": False, "error": "Exactly 5 images are required"}), 400

    embeddings = []
    debug_faces = []
    for idx, img_b64 in enumerate(images):
        try:
            if img_b64.startswith("data:"):
                img_b64 = img_b64.split(",", 1)[1]
            rgb = read_image_from_bytes(base64.b64decode(img_b64))
        except Exception:
            return jsonify({
                "success": False,
                "error": f"Invalid image data at index {idx}",
                "debug": {
                    "images_received": len(images),
                    "images_processed": len(embeddings),
                    "faces_detected": debug_faces,
                    "face_registration_success": False
                }
            }), 400

        faces = detect_faces_rgb(rgb)
        debug_faces.append({
            "image_index": idx,
            "faces_found": len(faces),
            "face_detected": len(faces) == 1
        })
        if len(faces) != 1:
            return jsonify({
                "success": False,
                "error": f"Ensure exactly one face in each image (failed at image {idx+1})",
                "debug": {
                    "images_received": len(images),
                    "images_processed": len(embeddings),
                    "faces_detected": debug_faces,
                    "face_registration_success": False
                }
            }), 400

        emb = extract_embedding(faces[0]['face'])
        if emb is None:
            return jsonify({
                "success": False,
                "error": f"Failed to extract face features for image {idx+1}",
                "debug": {
                    "images_received": len(images),
                    "images_processed": len(embeddings),
                    "faces_detected": debug_faces,
                    "face_registration_success": False
                }
            }), 500
        embeddings.append(emb.tolist())

    student_data = {
        "studentId": data['studentId'],
        "studentName": data['studentName'],
        "department": data['department'],
        "year": data['year'],
        "division": data['division'],
        "semester": data['semester'],
        "email": data['email'],
        "phoneNumber": data['phoneNumber'],
        "status": "active",
        "embeddings": embeddings,
        "face_registered": True,
        "created_at": time.time(),
        "updated_at": time.time()
    }

    result = students_col.insert_one(student_data)

    # Force recognition cache refresh so the newly registered face is immediately usable
    try:
        from student.demo_session import embedding_cache
        embedding_cache.student_embeddings = None
        embedding_cache.last_update = 0
    except Exception:
        pass

    logger = logging.getLogger(__name__)
    logger.info("Face registration debug: studentId=%s, images=%s, embeddings_saved=%s, face_detected=%s", 
                data['studentId'], len(images), len(embeddings), all(item['face_detected'] for item in debug_faces))

    return jsonify({
        "success": True,
        "studentId": data['studentId'],
        "record_id": str(result.inserted_id),
        "debug": {
            "images_received": len(images),
            "images_processed": len(embeddings),
            "faces_detected": debug_faces,
            "embeddings_saved": len(embeddings),
            "face_registration_success": True
        }
    })

@student_registration_bp.route('/api/students/count', methods=['GET'])
def get_student_count():
    db = current_app.config.get("DB")
    return jsonify({"success": True, "count": db.students.count_documents({})})

@student_registration_bp.route('/api/students/departments', methods=['GET'])
def get_departments():
    db = current_app.config.get("DB")
    departments = db.students.distinct("department")
    return jsonify({"success": True, "departments": departments, "count": len(departments)})
