import React from 'react';
import DatePickerMulti, { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';

interface DatePickerProps {
    id: string;
    placeholder?: string;
    value: Date;
    onChange: (date: Date) => void;
    className?: string;
}

const DatePicker: React.FC<DatePickerProps> = ({ id, placeholder, value, onChange, className }) => {
    
    const handleChange = (dateObject: DateObject | null) => {
        if (dateObject) {
            // Convert the selected Persian date object back to a standard JS Date (Gregorian)
            onChange(dateObject.toDate());
        }
    };

    return (
        <div className={`relative ${className || ''}`} id={id}>
            <DatePickerMulti
                value={value}
                onChange={handleChange}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-center"
                placeholder={placeholder || 'انتخاب تاریخ'}
                containerClassName="w-full"
                inputClass="rmdp-input"
                format="YYYY/MM/DD"
            />
        </div>
    );
};

export default DatePicker;