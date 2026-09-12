import time, os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--window-size=390,844")
opts.add_argument("--force-device-scale-factor=2")
opts.binary_location = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

driver = webdriver.Chrome(options=opts)

pages = ["home", "chat", "evidence", "track", "doc"]
out = "/Users/xuzihan/Documents/Projects/国创/anxin-app"

driver.get("http://localhost:9000/")
time.sleep(1.5)

for name in pages:
    driver.execute_script(f"""
      document.querySelector('[data-page="{name}"]').click();
    """)
    time.sleep(0.5)
    driver.save_screenshot(os.path.join(out, f"shot_{name}.png"))
    print(f"saved shot_{name}.png")

driver.quit()
print("done")
