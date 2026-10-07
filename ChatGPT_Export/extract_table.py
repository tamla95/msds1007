import sys
import pdfplumber
import json
import os

def extract_tables_to_markdown(pdf_path):
    md_content = []
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                if not tables:
                    continue
                    
                md_content.append(f"## Page {i+1} Tables\n")
                
                for t_idx, table in enumerate(tables):
                    if not table:
                        continue
                    
                    md_content.append(f"### Table {t_idx+1}\n")
                    
                    # Convert table to markdown
                    for row_idx, row in enumerate(table):
                        # clean up none and newlines in cells
                        clean_row = [str(cell).replace('\n', ' ').strip() if cell else '' for cell in row]
                        row_str = "| " + " | ".join(clean_row) + " |"
                        md_content.append(row_str)
                        
                        # Add markdown separator after header
                        if row_idx == 0:
                            separator = "| " + " | ".join(['---'] * len(clean_row)) + " |"
                            md_content.append(separator)
                            
                    md_content.append("\n")
                    
        return "\n".join(md_content)
    except Exception as e:
        return f"Error extracting tables: {str(e)}"

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
        
    result_md = extract_tables_to_markdown(pdf_path)
    
    # Output as JSON for Node.js to consume easily
    print(json.dumps({"success": True, "markdown": result_md}, ensure_ascii=False))
