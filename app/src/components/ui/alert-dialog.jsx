import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

const cx = (...classes) => classes.filter(Boolean).join(" ");

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;
export const AlertDialogOverlay = ({ className, ...props }) => (
  <AlertDialogPrimitive.Overlay className={cx("ui-alert-dialog-overlay", className)} {...props} />
);
export const AlertDialogContent = ({ className, ...props }) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content className={cx("ui-alert-dialog-content", className)} {...props} />
  </AlertDialogPortal>
);
export const AlertDialogHeader = ({ className, ...props }) => (
  <div className={cx("ui-alert-dialog-header", className)} {...props} />
);
export const AlertDialogFooter = ({ className, ...props }) => (
  <div className={cx("ui-alert-dialog-footer", className)} {...props} />
);
export const AlertDialogTitle = ({ className, ...props }) => (
  <AlertDialogPrimitive.Title className={cx("ui-alert-dialog-title", className)} {...props} />
);
export const AlertDialogDescription = ({ className, ...props }) => (
  <AlertDialogPrimitive.Description className={cx("ui-alert-dialog-description", className)} {...props} />
);
export const AlertDialogCancel = ({ className, ...props }) => (
  <AlertDialogPrimitive.Cancel className={cx("ui-alert-dialog-cancel", className)} {...props} />
);
export const AlertDialogAction = ({ className, ...props }) => (
  <AlertDialogPrimitive.Action className={cx("ui-alert-dialog-action", className)} {...props} />
);
