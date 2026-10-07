import sys
import fitz  # PyMuPDF
import json
import os

def extract_pdf_content(pdf_path):
    md_content = []
    images = []
    
    try:
        # PDF 파일이 저장된 경로(uploads)를 기준으로 이미지도 저장
        pdf_dir = os.path.dirname(pdf_path)
        base_name = os.path.splitext(os.path.basename(pdf_path))[0]
        
        doc = fitz.open(pdf_path)
        for i, page in enumerate(doc):
            md_content.append(f"## Page {i+1}\n")
            
            # 1. 레이아웃을 보존하며 텍스트 추출 (LLM 분석용)
            text = page.get_text("text")
            if text:
                md_content.append(text.strip())
                md_content.append("\n")
                
            # 2. 페이지 내 이미지 추출 (경고표지 그림문자용)
            image_list = page.get_images(full=True)
            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                # 이미지 파일 저장
                image_filename = f"{base_name}_page{i+1}_img{img_index}.{image_ext}"
                image_filepath = os.path.join(pdf_dir, image_filename)
                
                with open(image_filepath, "wb") as f:
                    f.write(image_bytes)
                    
                # 프론트엔드에서 접근 가능한 URL 경로로 저장 (uploads/...)
                image_url = f"/uploads/{image_filename}"
                images.append(image_url)
                md_content.append(f"\n[Image Extracted: {image_url}]\n")
                
        return "\n".join(md_content), images
    except Exception as e:
        return f"Error extracting content: {str(e)}", []

if __name__ == "__main__":
    # Ensure stdout uses UTF-8 to prevent encoding issues with Korean characters
    sys.stdout.reconfigure(encoding='utf-8')
    
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python extract_table.py <pdf_path>"}))
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    
    if not os.path.exists(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}))
        sys.exit(1)
        
    result_md, extracted_images = extract_pdf_content(pdf_path)
    
    # Output as JSON for Node.js to consume easily
    print(json.dumps({
        "success": True, 
        "markdown": result_md,
        "images": extracted_images
    }, ensure_ascii=False))
