import tkinter as tk
import numpy as np
import threading


class BoxDisplay:
    """
    显示框类，用于在屏幕上显示矩形框，标识识别到的目标区域
    """
    
    @staticmethod
    def show_box(top, left, width, height, duration=1000, color='red', sub_boxes=None):
        """
        在屏幕上显示一个矩形框
        
        参数:
        top: 矩形框左上角y坐标
        left: 矩形框左上角x坐标
        width: 矩形框宽度
        height: 矩形框高度
        duration: 显示持续时间(毫秒)
        color: 矩形框颜色
        sub_boxes: 子框列表，用于标识关键词等细节部分
        """
        def _draw():
            root = tk.Tk()
            root.overrideredirect(True)
            root.attributes('-topmost', True)
            root.geometry(f"{root.winfo_screenwidth()}x{root.winfo_screenheight()}+0+0")
            root.attributes('-transparentcolor', 'black')
            root.config(bg='black')

            canvas = tk.Canvas(root, bg='black', highlightthickness=0)
            canvas.pack(fill=tk.BOTH, expand=True)

            # 绘制主框
            canvas.create_rectangle(
                left, top, left + width, top + height,
                outline=color, width=3, fill=''
            )

            # 处理子框
            if sub_boxes is not None:
                for box in sub_boxes:
                    try:
                        points = np.array(box)
                        if points.shape != (4, 2):
                            print(f"警告：子框形状不是 (4,2)，跳过: {points.shape}")
                            continue
                        screen_points = points + [left, top]
                        x_coords = screen_points[:, 0]
                        y_coords = screen_points[:, 1]
                        x_min, x_max = x_coords.min(), x_coords.max()
                        y_min, y_max = y_coords.min(), y_coords.max()
                        canvas.create_rectangle(
                            x_min, y_min, x_max, y_max,
                            outline='yellow', width=1
                        )
                    except Exception as e:
                        print(f"绘制子框失败: {e}, box: {box}")

            root.after(duration, root.destroy)
            root.mainloop()
            
        # 在新线程中显示框，避免阻塞主线程
        thread = threading.Thread(target=_draw, daemon=True)
        thread.start()
        return thread